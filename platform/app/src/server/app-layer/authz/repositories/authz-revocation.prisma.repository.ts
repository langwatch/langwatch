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
  constructor(private readonly prisma: Pick<PrismaClient, "grant">) {}

  async enforceGrantRevocation({
    organizationId,
    grantIds,
    reason,
    revokedAt = new Date(),
  }: {
    organizationId: string;
    grantIds: string[];
    /** Why the queue is being bypassed. Counted and logged, never branched
     *  on — the write is identical either way; this is only how an operator
     *  finds these afterwards. */
    reason: "revocation" | "offboard";
    revokedAt?: Date;
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
      data: { revokedAt, revokedReason: reason },
    });
  }
}
