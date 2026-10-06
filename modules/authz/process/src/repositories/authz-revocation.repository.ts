import { createLogger } from "@langwatch/observability";
import { type Instant, nowInstant } from "@langwatch/time";
import { Counter } from "prom-client";

const logger = createLogger("langwatch:authz:revocation");

export type AuthzRevocationReason = "revocation" | "offboard";

/** Writes that bypassed the group queue, labelled by cause; the name is an external interface. */
export const authzDirectProjectionWriteTotal = new Counter({
  name: "langwatch_authz_direct_projection_write_total",
  help: "Authorization projection writes that bypassed the group queue, by cause",
  labelNames: ["reason"],
});

export type AuthzRevocationMark = {
  organizationId: string;
  grantIds: string[];
  revokedAt: Instant;
  revokedReason: string | null;
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

    authzDirectProjectionWriteTotal.labels(reason).inc();
    logger.info(
      { organizationId, reason, grantCount: grantIds.length },
      "authz read model written directly, bypassing the queue",
    );

    await this.markRevoked({ organizationId, grantIds, revokedAt, revokedReason });
  }

  protected abstract markRevoked(mark: AuthzRevocationMark): Promise<void>;
}
