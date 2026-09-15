/**
 * The synchronous deny: the one authorization write that reaches the read
 * model without an event behind it.
 *
 * Revoking normally goes through the queue like everything else. This exists
 * for the case where the answer has to change before the caller's request
 * returns — offboarding, and an operator pulling access during an incident —
 * because a queue that is slow, or stopped, must not leave someone holding
 * access they were just told they no longer have.
 *
 * It is safe to run alongside the event that says the same thing: the write
 * is the identical mark, so whichever lands second changes nothing. That is
 * the whole reason revocation is the only verb allowed to bypass the queue —
 * it can only ever deny earlier, never grant.
 */
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { getAuthzDirectProjectionWriteCounter } from "~/server/metrics";

const logger = createLogger("langwatch:authz:revocation");

export class PrismaAuthzRevocationRepository {
  constructor(
    private readonly prisma: Pick<PrismaClient, "grant" | "groupMembership">,
  ) {}

  /**
   * The membership half of the same bypass. A group membership is not a grant,
   * but removing one takes away every grant the group holds — so "the answer
   * has to change before the caller's request returns" applies to it word for
   * word, and it can only ever deny earlier, never grant.
   *
   * `removedAt: null` keeps this from moving an earlier removal's timestamp,
   * and means re-running it is free.
   */
  async enforceGroupMembershipRemoval({
    organizationId,
    membershipIds,
    reason,
    removedAt = new Date(),
    removedReason = null,
  }: {
    organizationId: string;
    membershipIds: string[];
    reason: "revocation" | "offboard";
    /** The event's authored timestamp. The queue's `group_member_removed`
     *  write guards on `removedAt: null`, so whatever this mark stamps is what
     *  the row keeps — it must be the SAME instant the event carries, or the
     *  audit answer to "when did they leave" is the bypass's clock. */
    removedAt?: Date;
    removedReason?: string | null;
  }): Promise<void> {
    if (membershipIds.length === 0) return;

    getAuthzDirectProjectionWriteCounter(reason).inc();
    logger.info(
      { organizationId, reason, membershipCount: membershipIds.length },
      "authz read model written directly, bypassing the queue",
    );

    // The organization bounds the write through the group, which is what
    // carries the tenancy — a membership row has no organization column of
    // its own, and a bare id list would be a cross-tenant write. Deliberately
    // NOT fenced on `Group.deletedAt`: this is a deny, and a deny must never
    // be refused on the grounds that the group it belongs to is on its way
    // out. It can only ever deny earlier, never grant.
    await this.prisma.groupMembership.updateMany({
      where: {
        id: { in: membershipIds },
        removedAt: null,
        group: { organizationId },
      },
      data: { removedAt, removedReason },
    });
  }

  async enforceGrantRevocation({
    organizationId,
    grantIds,
    reason,
    revokedAt = new Date(),
    revokedReason = null,
  }: {
    organizationId: string;
    grantIds: string[];
    /** Why the queue is being bypassed. Counted and logged, never branched
     *  on — the write is identical either way; this is only how an operator
     *  finds these afterwards. */
    reason: "revocation" | "offboard";
    /** The event's authored timestamp. The queue's `grant_revoked` write
     *  guards on `revokedAt: null`, so whatever this mark stamps is what the
     *  row keeps — it must be the SAME instant the event carries, or the
     *  audit answer to "when did access end" is the bypass's clock. */
    revokedAt?: Date;
    /** The caller's authored reason, exactly as the event carries it — same
     *  convergence argument as `revokedAt`. Null when the caller gave none;
     *  the bypass label above is telemetry, never row data. */
    revokedReason?: string | null;
  }): Promise<void> {
    if (grantIds.length === 0) return;

    // Counted and logged here rather than at the call sites: a caller that
    // forgot to record it is exactly the case that leaves a replay able to
    // resurrect revoked access.
    getAuthzDirectProjectionWriteCounter(reason).inc();
    logger.info(
      { organizationId, reason, grantCount: grantIds.length },
      "authz read model written directly, bypassing the queue",
    );

    // `revokedAt: null` keeps this from moving an earlier revocation's
    // timestamp, and means re-running it is free.
    await this.prisma.grant.updateMany({
      where: { organizationId, id: { in: grantIds }, revokedAt: null },
      data: { revokedAt, revokedReason },
    });
  }
}
