import { skipTenantCheck } from "@langwatch/prisma-client";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../../rules/identity-migration-names.rules.ts";
import { IdentityLatchRepository } from "../identity-latch.repository.ts";

/**
 * Whether a user's identifier history is proven (ADR-110, re-tenanted to
 * users). Only `finalized` opens it; `migrated` is HELD (landed but unproven),
 * and rollback pins `rolled_back` as an ops action, which a write never overrides.
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

  /** The runner's own guard: a write parked on the pin's row lock re-checks it, so SQL. */
  async recordFinalized({ userId, report }: { userId: string; report: unknown }): Promise<void> {
    const occurredAt = new Date();
    const reportJson = report == null ? null : JSON.stringify(report);
    const updated = await this.database.$executeRaw`
      ${skipTenantCheck({
        // Keyed by (migrationName, tenantId); the tenant is the key itself.
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "SystemMigrationTenantState"
         SET "status" = 'finalized',
             "report" = ${reportJson}::jsonb,
             "occurredAt" = ${occurredAt},
             "updatedAt" = now()
       WHERE "migrationName" = ${IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME}
         AND "tenantId" = ${userId}
         AND "status" <> 'rolled_back'
    `;
    if (updated > 0) return;
    try {
      await this.database.systemMigrationTenantState.create({
        data: {
          migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
          tenantId: userId,
          status: "finalized",
          report: report == null ? Prisma.DbNull : (report as Prisma.InputJsonValue),
          occurredAt,
        },
      });
    } catch (error) {
      // The row exists and the guarded update matched nothing: the pin wins.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
      throw error;
    }
  }
}
