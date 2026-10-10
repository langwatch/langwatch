import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { IdentityMigrationRepository } from "../identity-migration.repository.ts";

/**
 * Frozen SQL against the schema of the release that ships it: the D01 backfill's state rows
 * joined to the `User` columns the unproven test reads (`unproven-account.rules.ts`). The
 * migration name is the backfill's stable key, written out so the step never follows a rename.
 */
export class PrismaIdentityMigrationRepository extends IdentityMigrationRepository {
  static create(database: PrismaClient): PrismaIdentityMigrationRepository {
    return new PrismaIdentityMigrationRepository(database);
  }

  private constructor(private readonly database: PrismaClient) {
    super();
  }

  async reopenUnprovenAccounts({ dryRun }: { dryRun: boolean }): Promise<number> {
    if (dryRun) {
      const [row] = await this.database.$queryRaw<{ count: bigint }[]>`
        ${skipTenantCheck({
          // A fleet-wide step over (migrationName, tenantId); the tenant is the key.
          SKIP_TENANT_CHECK: true,
        })}
        SELECT count(*) AS "count"
          FROM "SystemMigrationTenantState" s
          JOIN "User" u ON u."id" = s."tenantId"
         WHERE s."migrationName" = 'identity-d01-identifier-backfill'
           AND s."status" = 'finalized'
           AND u."email" IS NOT NULL
           AND u."emailVerified" = false
           AND u."lastLoginAt" IS NULL
      `;
      return Number(row?.count ?? 0);
    }
    return this.database.$executeRaw`
      ${skipTenantCheck({
        // A fleet-wide step over (migrationName, tenantId); the tenant is the key.
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "SystemMigrationTenantState" s
         SET "status" = 'migrated',
             "report" = '{"kind":"unproven_account"}'::jsonb,
             "occurredAt" = now(),
             "updatedAt" = now()
        FROM "User" u
       WHERE u."id" = s."tenantId"
         AND s."migrationName" = 'identity-d01-identifier-backfill'
         AND s."status" = 'finalized'
         AND u."email" IS NOT NULL
         AND u."emailVerified" = false
         AND u."lastLoginAt" IS NULL
    `;
  }
}
