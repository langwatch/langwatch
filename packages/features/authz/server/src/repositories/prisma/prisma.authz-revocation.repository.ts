import { createLogger } from "@langwatch/observability";
import type { AuthzDatabase } from "../authz-read.repository";

const logger = createLogger("langwatch:authz:revocation");

export type AuthzRevocationReason = "revocation" | "offboard";

export abstract class AuthzRevocationTelemetry {
  abstract record(args: {
    organizationId: string;
    reason: AuthzRevocationReason;
    grantCount: number;
  }): void;
}

type RevocationDatabase = {
  grant: {
    updateMany(args: unknown): Promise<unknown>;
  };
};

export type PrismaAuthzRevocationRepositoryOptions = {
  database: AuthzDatabase;
  telemetry: AuthzRevocationTelemetry;
};

/** Synchronous deny effect; it can only mark live grants revoked. */
export class PrismaAuthzRevocationRepository {
  private readonly database: RevocationDatabase;

  static create(
    options: PrismaAuthzRevocationRepositoryOptions,
  ): PrismaAuthzRevocationRepository {
    return new PrismaAuthzRevocationRepository(options);
  }

  private constructor(
    private readonly options: PrismaAuthzRevocationRepositoryOptions,
  ) {
    this.database = options.database as unknown as RevocationDatabase;
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
    reason: AuthzRevocationReason;
    revokedAt?: Date;
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
      data: { revokedAt, revokedReason },
    });
  }
}
