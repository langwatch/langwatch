import { createLogger } from "@langwatch/observability";
import {
  type AuthzRevocationReason,
  AuthzRevocationTelemetryPort,
} from "../../ports/authz-revocation-telemetry.port.ts";
import type { AuthzDatabase } from "../authz-read.repository.ts";
import { type Instant, nowInstant, toDate } from "@langwatch/time";

const logger = createLogger("langwatch:authz:revocation");

type RevocationDatabase = {
  grant: {
    updateMany(args: unknown): Promise<unknown>;
  };
};

export type PrismaAuthzRevocationRepositoryOptions = {
  database: AuthzDatabase;
  telemetry: AuthzRevocationTelemetryPort;
};

/** Synchronous deny effect; it can only mark live grants revoked. */
export class PrismaAuthzRevocationRepository {
  private readonly database: RevocationDatabase;

  static create(options: PrismaAuthzRevocationRepositoryOptions): PrismaAuthzRevocationRepository {
    return new PrismaAuthzRevocationRepository(options);
  }

  private constructor(private readonly options: PrismaAuthzRevocationRepositoryOptions) {
    this.database = options.database as unknown as RevocationDatabase;
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
