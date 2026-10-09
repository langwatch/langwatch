import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ledgerTables } from "@langwatch/upgrade";

import { type MovedTenantSteps, OpsMigrationRepository } from "../ops-migration.repository.ts";

const TENANCY =
  "-- @tenancy: a fleet-wide step over (migrationName, tenantId); the tenant is the key.\n";

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
}
