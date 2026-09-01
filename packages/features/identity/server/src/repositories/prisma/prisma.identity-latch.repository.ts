import type { PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * The D01 backfill's name — the stable `SystemMigrationTenantState` key the
 * latch reads and the migration registers under, so the two share one
 * constant.
 *
 * It is a STORED key, not a label: renaming it orphans every record an
 * operator has already enrolled, which reads to this process as a fleet where
 * nobody has finalized. What operators read is the migration's own title. The
 * platform application declares the same string beside its own migration
 * (`server/app-layer/identity/migration-name.ts`); the two are pinned to each
 * other by this package's tests rather than by attention, because a
 * disagreement is silent — both tiers would simply answer "nobody is
 * latched".
 */
export const IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME =
  "identity-d01-identifier-backfill" as const;

/**
 * Whether a user's identifier history is in the log and proven — the one fact
 * that forks identity's reads and writes (ADR-110's rule, re-tenanted to
 * users: finishing the migration IS the switch).
 *
 * Only `finalized` opens it. `migrated` is the HELD state — the history landed
 * but the proof found the projection behind or disagreeing — and everything
 * else (absent, parked, rolled back) is closed. A rollback is therefore an ops
 * action rather than a deploy: pinning the row `rolled_back` closes the latch
 * for that user everywhere.
 *
 * Reads only, and deliberately narrow: the runner's state machine and its
 * compare-and-set live with the runner. This is the two questions a gate asks.
 */
export class PrismaIdentityLatchRepository {
  static create(database: PrismaClient): PrismaIdentityLatchRepository {
    return new PrismaIdentityLatchRepository(database);
  }

  private constructor(private readonly database: PrismaClient) {}

  /**
   * Has ANY user finished the backfill? The question the per-user read asks
   * first: while the answer is no, no user can be past the latch, so the
   * per-user lookup is pure cost on every authenticated request.
   *
   * `findFirst` stops at the first matching row rather than counting them all.
   */
  async hasAnyoneFinalized(): Promise<boolean> {
    const row = await this.database.systemMigrationTenantState.findFirst({
      where: {
        migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
        status: "finalized",
      },
      select: { tenantId: true },
    });
    return row !== null;
  }

  /** Whether THIS user's identifiers are the truth about their addresses. */
  async isFinalized({ userId }: { userId: string }): Promise<boolean> {
    const row = await this.database.systemMigrationTenantState.findUnique({
      where: {
        migrationName_tenantId: {
          migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
          tenantId: userId,
        },
      },
      select: { status: true },
    });
    return row?.status === "finalized";
  }
}
