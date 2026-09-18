import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../../rules/identity-migration-names.rules.ts";
import { IdentityLatchRepository } from "../identity-latch.repository.ts";

/**
 * Whether a user's identifier history is proven (ADR-110, re-tenanted to
 * users). Only `finalized` opens it; `migrated` is HELD (landed but unproven),
 * and rollback pins `rolled_back` as an ops action. Reads only, no writes.
 */
export class PrismaIdentityLatchRepository extends IdentityLatchRepository {
  static create(database: PrismaClient): PrismaIdentityLatchRepository {
    return new PrismaIdentityLatchRepository(database);
  }

  private constructor(private readonly database: PrismaClient) {
    super();
  }

  /**
   * Has ANY user finished the backfill? Asked first: while no, the per-user
   * lookup is pure cost on every request. `findFirst` stops at the first
   * matching row rather than counting them all.
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
