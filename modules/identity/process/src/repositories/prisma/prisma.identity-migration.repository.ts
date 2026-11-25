import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { IdentityMigrationRepository } from "../identity-migration.repository.ts";

/**
 * Frozen SQL: the D01 state rows joined to the `User` columns and sign-in rows the hold reads
 * (`unproven-account.rules.ts`). The migration name is written out so it never follows a rename.
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
           AND (u."passkeySignupClaimHash" IS NOT NULL
                OR EXISTS (SELECT 1 FROM "Account" a WHERE a."userId" = u."id")
                OR EXISTS (SELECT 1 FROM "Passkey" p WHERE p."userId" = u."id"))
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
         AND (u."passkeySignupClaimHash" IS NOT NULL
              OR EXISTS (SELECT 1 FROM "Account" a WHERE a."userId" = u."id")
              OR EXISTS (SELECT 1 FROM "Passkey" p WHERE p."userId" = u."id"))
    `;
  }

  async carryOverSignInSwitch({ dryRun }: { dryRun: boolean }): Promise<number> {
    if (dryRun) {
      const [row] = await this.database.$queryRaw<{ count: bigint }[]>`
        ${skipTenantCheck({
          // A fleet-wide step over (migrationName, tenantId); the user is the key.
          SKIP_TENANT_CHECK: true,
        })}
        SELECT count(*) AS "count"
          FROM "SystemMigrationTenantState" s
          LEFT JOIN "IdentitySignInSwitch" w ON w."userId" = s."tenantId"
         WHERE s."migrationName" = 'identity-d01-identifier-backfill'
           AND ((w."userId" IS NULL AND s."status" IN ('finalized', 'rolled_back'))
                OR w."switchedAt" < s."occurredAt")
      `;
      return Number(row?.count ?? 0);
    }
    return this.database.$executeRaw`
      ${skipTenantCheck({
        // A fleet-wide step over (migrationName, tenantId); the user is the key.
        SKIP_TENANT_CHECK: true,
      })}
      INSERT INTO "IdentitySignInSwitch" ("userId", "onIdentifiers", "pinned", "switchedAt", "updatedAt")
      SELECT s."tenantId", s."status" = 'finalized', s."status" = 'rolled_back', s."occurredAt", now()
        FROM "SystemMigrationTenantState" s
        LEFT JOIN "IdentitySignInSwitch" w ON w."userId" = s."tenantId"
       WHERE s."migrationName" = 'identity-d01-identifier-backfill'
         AND ((w."userId" IS NULL AND s."status" IN ('finalized', 'rolled_back'))
              OR w."switchedAt" < s."occurredAt")
      ON CONFLICT ("userId") DO UPDATE
         SET "onIdentifiers" = EXCLUDED."onIdentifiers",
             "pinned" = EXCLUDED."pinned",
             "switchedAt" = EXCLUDED."switchedAt",
             "updatedAt" = now()
       WHERE "IdentitySignInSwitch"."switchedAt" < EXCLUDED."switchedAt"
    `;
  }
}
