import { AUTHZ_ENGINE_MIGRATION_NAME } from "@langwatch/authz-contract";
import { prismaTables, skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, type Instant, toDate } from "@langwatch/time";

import {
  type AuthzEngineSwitch,
  decideEngineSwitch,
} from "../../rules/authz-engine-switch.rules.ts";
import { AuthzCutoverRepository } from "../authz-cutover.repository.ts";

export type AuthzCutoverDatabase = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;

type SwitchRows = {
  ownOnEngine: boolean | null;
  ownSwitchedAt: Date | null;
  legacyStatus: string | null;
  legacyOccurredAt: Date | null;
};

/** Authz's switch row and ops' older state row for one organization, read in one statement. */
export class PrismaAuthzCutoverRepository extends AuthzCutoverRepository {
  static readonly tables = prismaTables("AuthzEngineSwitch");

  static create(options: { database: AuthzCutoverDatabase }): PrismaAuthzCutoverRepository {
    return new PrismaAuthzCutoverRepository(options.database);
  }

  private constructor(private readonly database: AuthzCutoverDatabase) {
    super();
  }

  async getEngineSwitch({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AuthzEngineSwitch> {
    const [row] = await this.database.$queryRaw<SwitchRows[]>`
      ${skipTenantCheck({
        // Both rows are keyed by the organization itself.
        SKIP_TENANT_CHECK: true,
      })}
      SELECT w."onEngine" AS "ownOnEngine", w."switchedAt" AS "ownSwitchedAt",
             s."status" AS "legacyStatus", s."occurredAt" AS "legacyOccurredAt"
        FROM (SELECT ${organizationId}::text AS "id") o
        LEFT JOIN "AuthzEngineSwitch" w ON w."organizationId" = o."id"
        LEFT JOIN "SystemMigrationTenantState" s
          ON s."migrationName" = ${AUTHZ_ENGINE_MIGRATION_NAME} AND s."tenantId" = o."id"
    `;
    return decideEngineSwitch({
      own:
        row?.ownOnEngine != null && row.ownSwitchedAt
          ? { onEngine: row.ownOnEngine, switchedAt: fromDate(row.ownSwitchedAt) }
          : null,
      legacy:
        row?.legacyStatus != null && row.legacyOccurredAt
          ? { status: row.legacyStatus, occurredAt: fromDate(row.legacyOccurredAt) }
          : null,
    });
  }

  async switchOnEngine({
    organizationId,
    at,
  }: {
    organizationId: string;
    at: Instant;
  }): Promise<boolean> {
    const written = await this.database.$executeRaw`
      ${skipTenantCheck({
        // Both rows are keyed by the organization itself.
        SKIP_TENANT_CHECK: true,
      })}
      INSERT INTO "AuthzEngineSwitch" ("organizationId", "onEngine", "pinned", "switchedAt", "updatedAt")
      SELECT ${organizationId}, true, false, ${toDate(at)}, now()
       WHERE NOT EXISTS (SELECT 1 FROM "SystemMigrationTenantState"
                          WHERE "migrationName" = ${AUTHZ_ENGINE_MIGRATION_NAME}
                            AND "tenantId" = ${organizationId}
                            AND "status" = 'rolled_back')
      ON CONFLICT ("organizationId") DO UPDATE
         SET "onEngine" = true, "switchedAt" = EXCLUDED."switchedAt", "updatedAt" = now()
       WHERE NOT "AuthzEngineSwitch"."pinned"
    `;
    return written > 0;
  }

  async pinEngineSwitch({
    organizationId,
    at,
    eventId,
  }: {
    organizationId: string;
    at: Instant;
    eventId: string;
  }): Promise<void> {
    await this.database.$executeRaw`
      ${skipTenantCheck({
        // Keyed by the organization itself.
        SKIP_TENANT_CHECK: true,
      })}
      INSERT INTO "AuthzEngineSwitch"
        ("organizationId", "onEngine", "pinned", "switchedAt", "lastAppliedEventId", "updatedAt")
      VALUES (${organizationId}, false, true, ${toDate(at)}, ${eventId}, now())
      ON CONFLICT ("organizationId") DO UPDATE
         SET "onEngine" = false,
             "pinned" = true,
             "switchedAt" = GREATEST("AuthzEngineSwitch"."switchedAt", EXCLUDED."switchedAt"),
             "lastAppliedEventId" = EXCLUDED."lastAppliedEventId",
             "updatedAt" = now()
    `;
  }

  /** Frozen SQL: finalized is on, rolled back is pinned off; a newer authz row is kept. */
  async carryOverEngineSwitch({ dryRun }: { dryRun: boolean }): Promise<number> {
    if (dryRun) {
      const [row] = await this.database.$queryRaw<{ count: bigint }[]>`
        ${skipTenantCheck({
          // A fleet-wide step over (migrationName, tenantId); the organization is the key.
          SKIP_TENANT_CHECK: true,
        })}
        SELECT count(*) AS "count"
          FROM "SystemMigrationTenantState" s
          LEFT JOIN "AuthzEngineSwitch" w ON w."organizationId" = s."tenantId"
         WHERE s."migrationName" = 'authz-engine'
           AND ((w."organizationId" IS NULL AND s."status" IN ('finalized', 'rolled_back'))
                OR w."switchedAt" < s."occurredAt")
      `;
      return Number(row?.count ?? 0);
    }
    return this.database.$executeRaw`
      ${skipTenantCheck({
        // A fleet-wide step over (migrationName, tenantId); the organization is the key.
        SKIP_TENANT_CHECK: true,
      })}
      INSERT INTO "AuthzEngineSwitch" ("organizationId", "onEngine", "pinned", "switchedAt", "updatedAt")
      SELECT s."tenantId", s."status" = 'finalized', s."status" = 'rolled_back', s."occurredAt", now()
        FROM "SystemMigrationTenantState" s
        LEFT JOIN "AuthzEngineSwitch" w ON w."organizationId" = s."tenantId"
       WHERE s."migrationName" = 'authz-engine'
         AND ((w."organizationId" IS NULL AND s."status" IN ('finalized', 'rolled_back'))
              OR w."switchedAt" < s."occurredAt")
      ON CONFLICT ("organizationId") DO UPDATE
         SET "onEngine" = EXCLUDED."onEngine",
             "pinned" = EXCLUDED."pinned",
             "switchedAt" = EXCLUDED."switchedAt",
             "updatedAt" = now()
       WHERE "AuthzEngineSwitch"."switchedAt" < EXCLUDED."switchedAt"
    `;
  }
}
