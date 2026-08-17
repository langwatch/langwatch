import type {
  SystemMigrationStateRepository,
  TenantMigrationRecord,
  TenantMigrationStatus,
} from "@langwatch/system-migrations";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";

const TENANT_STATUSES: readonly TenantMigrationStatus[] = [
  "migrated",
  "finalized",
  "parked",
  "rolled_back",
];

function parseStatus(raw: string): TenantMigrationStatus {
  const status = TENANT_STATUSES.find((candidate) => candidate === raw);
  if (!status) {
    throw new Error(`unknown system migration status stored: ${raw}`);
  }
  return status;
}

/**
 * The stored per-(migration, tenant) state - the runner's port plus the ops
 * finders the dashboard reads. `SystemMigrationTenantState` has no tenant FK
 * on purpose (the runner is generic over tenants), so every query here keys
 * by migration name first.
 */
export class PrismaSystemMigrationStateRepository
  implements SystemMigrationStateRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findRecord({
    migrationName,
    tenantId,
  }: {
    migrationName: string;
    tenantId: string;
  }): Promise<TenantMigrationRecord | null> {
    const row = await this.prisma.systemMigrationTenantState.findUnique({
      where: { migrationName_tenantId: { migrationName, tenantId } },
    });
    if (!row) return null;
    return {
      migrationName: row.migrationName,
      tenantId: row.tenantId,
      status: parseStatus(row.status),
      report: row.report,
    };
  }

  async upsertRecord(record: TenantMigrationRecord): Promise<void> {
    // `undefined` would OMIT the column, leaving a previous parked tenant's
    // error report attached to the finalized row that replaced it. The
    // no-report case has to be written, and for a nullable Json column
    // that means the DbNull sentinel rather than a bare null.
    const report =
      record.report == null
        ? Prisma.DbNull
        : (record.report as Prisma.InputJsonValue);
    await this.prisma.systemMigrationTenantState.upsert({
      where: {
        migrationName_tenantId: {
          migrationName: record.migrationName,
          tenantId: record.tenantId,
        },
      },
      create: {
        migrationName: record.migrationName,
        tenantId: record.tenantId,
        status: record.status,
        report,
      },
      update: { status: record.status, report },
    });
  }

  /** Ops rollup: how many tenants sit in each status for one migration. */
  async findStatusCounts({
    migrationName,
  }: {
    migrationName: string;
  }): Promise<Record<TenantMigrationStatus, number>> {
    const grouped = await this.prisma.systemMigrationTenantState.groupBy({
      by: ["status"],
      where: { migrationName },
      _count: { _all: true },
    });
    const counts: Record<TenantMigrationStatus, number> = {
      migrated: 0,
      finalized: 0,
      parked: 0,
      rolled_back: 0,
    };
    for (const row of grouped) {
      counts[parseStatus(row.status)] = row._count._all;
    }
    return counts;
  }

  /** Ops drill-down: the tenants needing attention, newest movement first. */
  async findRecordsByStatus({
    migrationName,
    statuses,
    limit,
  }: {
    migrationName: string;
    statuses: TenantMigrationStatus[];
    limit: number;
  }): Promise<Array<TenantMigrationRecord & { updatedAt: Date }>> {
    const rows = await this.prisma.systemMigrationTenantState.findMany({
      where: { migrationName, status: { in: statuses } },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    return rows.map((row) => ({
      migrationName: row.migrationName,
      tenantId: row.tenantId,
      status: parseStatus(row.status),
      report: row.report,
      updatedAt: row.updatedAt,
    }));
  }
}
