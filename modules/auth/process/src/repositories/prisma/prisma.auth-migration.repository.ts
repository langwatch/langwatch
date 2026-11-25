import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { AuthMigrationRepository } from "../auth-migration.repository.ts";

/**
 * Raw SQL so the write leaves `updatedAt` alone: the typed client would stamp it, and identity's
 * secret heal would then copy each row over its credential.
 */
export class PrismaAuthMigrationRepository extends AuthMigrationRepository {
  static create(database: PrismaClient): PrismaAuthMigrationRepository {
    return new PrismaAuthMigrationRepository(database);
  }

  private constructor(private readonly database: PrismaClient) {
    super();
  }

  async discardProviderTokens({ dryRun }: { dryRun: boolean }): Promise<number> {
    if (dryRun) {
      const [row] = await this.database.$queryRaw<{ count: bigint }[]>`
        ${skipTenantCheck({
          // A fleet-wide step over every user's accounts; `Account` has no tenant column.
          SKIP_TENANT_CHECK: true,
        })}
        SELECT count(*) AS "count"
          FROM "Account"
         WHERE "access_token" IS NOT NULL
            OR "refresh_token" IS NOT NULL
            OR "id_token" IS NOT NULL
      `;
      return Number(row?.count ?? 0);
    }
    return this.database.$executeRaw`
      ${skipTenantCheck({
        // A fleet-wide step over every user's accounts; `Account` has no tenant column.
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "Account"
         SET "access_token" = NULL,
             "refresh_token" = NULL,
             "id_token" = NULL
       WHERE "access_token" IS NOT NULL
          OR "refresh_token" IS NOT NULL
          OR "id_token" IS NOT NULL
    `;
  }
}
