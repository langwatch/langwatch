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

function isRecordNotFound(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  );
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
    // The transition's own business time, stamped by the writer. It is what
    // the grants-ledger projection orders folded transitions against, and it
    // has to be written here too: a direct write that left the column alone
    // would let a replayed fact from last year overwrite the latch this call
    // just set. `updatedAt` cannot serve - it moves for reasons that are not
    // transitions.
    const occurredAt = new Date();
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
        occurredAt,
      },
      update: { status: record.status, report, occurredAt },
    });
  }

  /**
   * The runner's compare-and-set (see the port's own doc): `update` with the
   * guard in its (filtered-unique) where, NOT `updateMany` — Prisma 7's
   * compiler splits a conditional `updateMany` into a SELECT of matching ids
   * and an UPDATE keyed on those ids ALONE, so the `status != rolled_back`
   * guard does not ride the UPDATE statement and an operator's pin written
   * between the SELECT and the UPDATE gets silently overwritten
   * (read-then-write, not compare-and-swap). `update` keeps its full filter
   * on the UPDATE itself, where Postgres re-evaluates it against the current
   * row after the lock wait — the loser matches zero rows and surfaces as
   * P2025 instead of clobbering the pin. A row that does not exist yet is
   * created; a create that collides on the unique key means the row appeared
   * since the guarded update ran, and the only writer that creates
   * nothing-to-rolled_back transitions is nobody (the operator can only pin
   * an EXISTING record), so the collision is read as the pin standing and
   * answered `false`.
   */
  async upsertRecordUnlessRolledBack(
    record: TenantMigrationRecord,
  ): Promise<boolean> {
    const report =
      record.report == null
        ? Prisma.DbNull
        : (record.report as Prisma.InputJsonValue);
    const occurredAt = new Date();
    try {
      await this.prisma.systemMigrationTenantState.update({
        where: {
          migrationName_tenantId: {
            migrationName: record.migrationName,
            tenantId: record.tenantId,
          },
          NOT: { status: "rolled_back" },
        },
        data: { status: record.status, report, occurredAt },
      });
      return true;
    } catch (error) {
      if (!isRecordNotFound(error)) throw error;
    }
    try {
      await this.prisma.systemMigrationTenantState.create({
        data: {
          migrationName: record.migrationName,
          tenantId: record.tenantId,
          status: record.status,
          report,
          occurredAt,
        },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        // The row exists and the guarded update matched nothing: the stored
        // status is `rolled_back`, and the pin wins.
        return false;
      }
      throw error;
    }
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
