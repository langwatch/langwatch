import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ledgerTables } from "@langwatch/upgrade";

import { type MovedTenantSteps, OpsMigrationRepository } from "../ops-migration.repository.ts";

// A fleet-wide step over (migrationName, tenantId); the tenant is the key.
const TENANCY = `${skipTenantCheck({ SKIP_TENANT_CHECK: true }).sql}\n`;
// A fleet-wide step over (organizationId, migrationName); the organization is the key.
const ENROLMENT_TENANCY = `${skipTenantCheck({ SKIP_TENANT_CHECK: true }).sql}\n`;

/** Frozen SQL against the release that ships it: ops' state rows into the ledger schema's table. */
export class PrismaOpsMigrationRepository extends OpsMigrationRepository {
  static create({ prisma }: { prisma: PrismaClient }): PrismaOpsMigrationRepository {
    return new PrismaOpsMigrationRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async copyTenantState({
    moves,
    dryRun,
  }: {
    moves: MovedTenantSteps;
    dryRun: boolean;
  }): Promise<number> {
    const { tenantState } = await ledgerTables({
      postgres: {
        query: async <Row extends object>(text: string, values: unknown[] = []) => ({
          rows: await this.prisma.$queryRawUnsafe<Row[]>(`${TENANCY}${text}`, ...values),
        }),
      },
    });
    const names = [Object.keys(moves), Object.values(moves)];
    const finished = `FROM "SystemMigrationTenantState" s
      JOIN unnest($1::text[], $2::text[]) AS moved("legacy_name", "step_id")
        ON moved."legacy_name" = s."migrationName"
     WHERE s."status" IN ('finalized', 'rolled_back')`;
    if (dryRun) {
      const [row] = await this.prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `${TENANCY}SELECT count(*) AS "count" ${finished}
           AND NOT EXISTS (SELECT 1 FROM ${tenantState} t
                            WHERE t."step_id" = moved."step_id" AND t."tenant_id" = s."tenantId")`,
        ...names,
      );
      return Number(row?.count ?? 0);
    }
    return this.prisma.$executeRawUnsafe(
      `${TENANCY}INSERT INTO ${tenantState} ("step_id", "tenant_id", "status", "report", "updated_at")
       SELECT moved."step_id", s."tenantId", s."status", s."report", now() ${finished}
       ON CONFLICT ("step_id", "tenant_id") DO NOTHING`,
      ...names,
    );
  }

  async recopyTenantStateAfterRollout({
    moves,
    dryRun,
  }: {
    moves: MovedTenantSteps;
    dryRun: boolean;
  }): Promise<number> {
    const { tenantState } = await ledgerTables({
      postgres: {
        query: async <Row extends object>(text: string, values: unknown[] = []) => ({
          rows: await this.prisma.$queryRawUnsafe<Row[]>(`${TENANCY}${text}`, ...values),
        }),
      },
    });
    const names = [Object.keys(moves), Object.values(moves)];
    // The older table stores UTC wall-clock without a zone; the step's table keeps instants.
    const changed = `FROM "SystemMigrationTenantState" s
      JOIN unnest($1::text[], $2::text[]) AS moved("legacy_name", "step_id")
        ON moved."legacy_name" = s."migrationName"`;
    if (dryRun) {
      const [row] = await this.prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `${TENANCY}SELECT count(*) AS "count" ${changed}
          WHERE NOT EXISTS (SELECT 1 FROM ${tenantState} t
                             WHERE t."step_id" = moved."step_id" AND t."tenant_id" = s."tenantId"
                               AND (t."status" = 'rolled_back'
                                    OR t."updated_at" >= (s."updatedAt" AT TIME ZONE 'UTC')))`,
        ...names,
      );
      return Number(row?.count ?? 0);
    }
    return this.prisma.$executeRawUnsafe(
      `${TENANCY}INSERT INTO ${tenantState} AS t
         ("step_id", "tenant_id", "status", "report", "held_reason", "held_since", "updated_at")
       SELECT moved."step_id", s."tenantId", s."status", s."report",
              CASE WHEN s."status" = 'migrated' THEN 'proof' END,
              CASE WHEN s."status" = 'migrated' THEN now() END,
              s."updatedAt" AT TIME ZONE 'UTC'
       ${changed}
       ON CONFLICT ("step_id", "tenant_id") DO UPDATE SET
         "status" = EXCLUDED."status", "report" = EXCLUDED."report",
         "held_reason" = EXCLUDED."held_reason", "held_since" = EXCLUDED."held_since",
         "updated_at" = now()
       WHERE t."status" <> 'rolled_back' AND t."updated_at" < EXCLUDED."updated_at"`,
      ...names,
    );
  }

  async withdrawEnrolmentsAfterRollout({
    moves,
    dryRun,
  }: {
    moves: MovedTenantSteps;
    dryRun: boolean;
  }): Promise<number> {
    const names = [Object.keys(moves), Object.values(moves)];
    const twinGone = `NOT EXISTS (SELECT 1 FROM "SystemMigrationEnrollment" e
                       WHERE e."migrationName" = moved."legacy_name"
                         AND e."organizationId" = n."organizationId")`;
    if (dryRun) {
      const [row] = await this.prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `${ENROLMENT_TENANCY}SELECT count(*) AS "count" FROM "SystemMigrationEnrollment" n
           JOIN unnest($1::text[], $2::text[]) AS moved("legacy_name", "step_id")
             ON moved."step_id" = n."migrationName"
          WHERE ${twinGone}`,
        ...names,
      );
      return Number(row?.count ?? 0);
    }
    return this.prisma.$executeRawUnsafe(
      `${ENROLMENT_TENANCY}DELETE FROM "SystemMigrationEnrollment" n
        USING unnest($1::text[], $2::text[]) AS moved("legacy_name", "step_id")
        WHERE n."migrationName" = moved."step_id" AND ${twinGone}`,
      ...names,
    );
  }

  async copyEnrolments({
    moves,
    dryRun,
  }: {
    moves: MovedTenantSteps;
    dryRun: boolean;
  }): Promise<number> {
    const names = [Object.keys(moves), Object.values(moves)];
    const enrolled = `FROM "SystemMigrationEnrollment" e
      JOIN unnest($1::text[], $2::text[]) AS moved("legacy_name", "step_id")
        ON moved."legacy_name" = e."migrationName"`;
    if (dryRun) {
      const [row] = await this.prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `${ENROLMENT_TENANCY}SELECT count(*) AS "count" ${enrolled}
          WHERE NOT EXISTS (SELECT 1 FROM "SystemMigrationEnrollment" n
                             WHERE n."migrationName" = moved."step_id"
                               AND n."organizationId" = e."organizationId")`,
        ...names,
      );
      return Number(row?.count ?? 0);
    }
    return this.prisma.$executeRawUnsafe(
      `${ENROLMENT_TENANCY}INSERT INTO "SystemMigrationEnrollment"
         ("organizationId", "migrationName", "enrolledByUserId", "createdAt")
       SELECT e."organizationId", moved."step_id", e."enrolledByUserId", e."createdAt" ${enrolled}
       ON CONFLICT ("organizationId", "migrationName") DO NOTHING`,
      ...names,
    );
  }
}
