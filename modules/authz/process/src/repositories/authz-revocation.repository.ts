import { createLogger } from "@langwatch/observability";
import { counter } from "@langwatch/observability/metrics";
import { type Instant, nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:authz:revocation");

export type AuthzRevocationReason = "revocation" | "offboard";

/** Writes that bypassed the group queue, labelled by cause; the name is an external interface. */
export const authzDirectProjectionWriteTotal = counter({
  name: "langwatch_authz_direct_projection_write_total",
  description: "Authorization projection writes that bypassed the group queue, by cause",
});

export type AuthzRevocationMark = {
  organizationId: string;
  grantIds: string[];
  revokedAt: Instant;
  revokedReason: string | null;
};

/** A role marked deleted ahead of its fold, at the instant its delete fact carries. */
export type AuthzRoleDeletionMark = {
  organizationId: string;
  roleId: string;
  deletedAt: Instant;
};

/**
 * The synchronous deny: it can only mark live grants of the named organization revoked, and
 * never moves an earlier mark. Every backing counts the write it makes outside the queue.
 */
export abstract class AuthzRevocationRepository {
  async enforceGrantRevocation({
    organizationId,
    grantIds,
    reason,
    revokedAt = nowInstant(),
    revokedReason = null,
  }: {
    organizationId: string;
    grantIds: string[];
    reason: AuthzRevocationReason;
    revokedAt?: Instant;
    revokedReason?: string | null;
  }): Promise<void> {
    if (grantIds.length === 0) return;

    authzDirectProjectionWriteTotal.inc({ reason });
    logger.info(
      { organizationId, reason, grantCount: grantIds.length },
      "authz read model written directly, bypassing the queue",
    );

    await this.markRevoked({ organizationId, grantIds, revokedAt, revokedReason });
  }

  /**
   * The role's delete, written ahead of its fold with the fold's own guards: a define that reads
   * the Role head next sees it, so it neither skips nor confirms on a role about to go.
   */
  async enforceRoleDeletion(mark: AuthzRoleDeletionMark): Promise<void> {
    authzDirectProjectionWriteTotal.inc({ reason: "revocation" });
    await this.markRoleDeleted(mark);
  }

  protected abstract markRevoked(mark: AuthzRevocationMark): Promise<void>;

  protected abstract markRoleDeleted(mark: AuthzRoleDeletionMark): Promise<void>;
}
