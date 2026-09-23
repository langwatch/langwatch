import { createLogger } from "@langwatch/observability";
import { type Instant, nowInstant, toDate } from "@langwatch/time";

import type { AuthzRevocationTelemetry } from "../../services/authz-revocation-telemetry.service.ts";
import { type AuthzRevocationReason } from "../../services/authz-revocation-telemetry.service.ts";

const logger = createLogger("langwatch:authz:revocation");

/** The one write this repository performs, and no other. */
export type RevocationDatabase = {
  grant: {
    updateMany(args: unknown): Promise<unknown>;
  };
};

export type PrismaAuthzRevocationRepositoryOptions = {
  database: RevocationDatabase;
  telemetry: AuthzRevocationTelemetry;
};

/** Synchronous deny effect; it can only mark live grants revoked. */
export class PrismaAuthzRevocationRepository {
  private readonly database: RevocationDatabase;

  static create(options: PrismaAuthzRevocationRepositoryOptions): PrismaAuthzRevocationRepository {
    return new PrismaAuthzRevocationRepository(options);
  }

  private constructor(private readonly options: PrismaAuthzRevocationRepositoryOptions) {
    this.database = options.database;
  }

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

    this.options.telemetry.record({
      organizationId,
      reason,
      grantCount: grantIds.length,
    });
    logger.info(
      { organizationId, reason, grantCount: grantIds.length },
      "authz read model written directly, bypassing the queue",
    );

    await this.database.grant.updateMany({
      where: { organizationId, id: { in: grantIds }, revokedAt: null },
      data: { revokedAt: toDate(revokedAt), revokedReason },
    });
  }
}
