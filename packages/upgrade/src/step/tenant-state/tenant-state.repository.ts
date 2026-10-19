import {
  HELD_REASONS,
  SystemMigrationRecordNotFoundError,
  type SystemMigrationStateRepository,
  TENANT_MIGRATION_STATUSES,
  type TenantMigrationRecord,
  type TenantMigrationStatus,
} from "@langwatch/system-migrations";
import { type Instant, Temporal } from "@langwatch/time";

import { type LedgerTableNames, ledgerTables } from "../../ledger-tables.ts";
import type { UpgradePostgres } from "../../ports.ts";

/** One tenant's state with when it last moved, as Ops' attention list reads it. */
export type TenantStepStateRow = TenantMigrationRecord & { updatedAt: Instant };

type StateRow = {
  status: string;
  report: unknown;
  held_reason: string | null;
  held_since_ms: string | null;
};

/**
 * Every `.withMigrations` tenant step's per-tenant state, in one table beside the ledger
 * (Alex, 2026-10-09, S6-3). The runner owns the state machine; this stores its facts.
 */
export class TenantStepStateRepository implements SystemMigrationStateRepository {
  static create({ postgres }: { postgres: UpgradePostgres }): TenantStepStateRepository {
    return new TenantStepStateRepository(postgres);
  }

  private constructor(private readonly postgres: UpgradePostgres) {}

  async getRecord({
    migrationName,
    tenantId,
  }: {
    migrationName: string;
    tenantId: string;
  }): Promise<TenantMigrationRecord> {
    const table = await this.table();
    const { rows } = await this.postgres.query<StateRow>(
      `SELECT "status", "report", "held_reason",
        (extract(epoch FROM "held_since") * 1000)::bigint::text AS "held_since_ms"
       FROM ${table} WHERE "step_id" = $1 AND "tenant_id" = $2`,
      [migrationName, tenantId],
    );
    const row = rows[0];
    if (!row) throw new SystemMigrationRecordNotFoundError({ migrationName, tenantId });
    return recordOf({ migrationName, tenantId, row });
  }

  async findRecords({
    migrationName,
    tenantIds,
  }: {
    migrationName: string;
    tenantIds: readonly string[];
  }): Promise<TenantMigrationRecord[]> {
    if (tenantIds.length === 0) return [];
    const table = await this.table();
    const { rows } = await this.postgres.query<StateRow & { tenant_id: string }>(
      `SELECT "tenant_id", "status", "report", "held_reason",
        (extract(epoch FROM "held_since") * 1000)::bigint::text AS "held_since_ms"
       FROM ${table} WHERE "step_id" = $1 AND "tenant_id" = ANY($2::text[])`,
      [migrationName, [...tenantIds]],
    );
    return rows.map((row) => recordOf({ migrationName, tenantId: row.tenant_id, row }));
  }

  async upsertRecord(record: TenantMigrationRecord): Promise<void> {
    await this.write({ record, unlessRolledBack: false });
  }

  async upsertRecordUnlessRolledBack(record: TenantMigrationRecord): Promise<boolean> {
    return this.write({ record, unlessRolledBack: true });
  }

  async hasFinalizedTenant({ migrationName }: { migrationName: string }): Promise<boolean> {
    const table = await this.table();
    const { rows } = await this.postgres.query<{ found: number }>(
      `SELECT 1 AS "found" FROM ${table}
       WHERE "step_id" = $1 AND "status" = 'finalized' LIMIT 1`,
      [migrationName],
    );
    return rows.length > 0;
  }

  /** A tenant the step has parked or holds (its proof disagreed, or its queued work waits). */
  async hasUnsettledTenant({ migrationName }: { migrationName: string }): Promise<boolean> {
    const table = await this.table();
    const { rows } = await this.postgres.query<{ found: number }>(
      `SELECT 1 AS "found" FROM ${table}
       WHERE "step_id" = $1 AND ("status" = 'parked' OR "held_reason" IS NOT NULL) LIMIT 1`,
      [migrationName],
    );
    return rows.length > 0;
  }

  /** Whether a later pass could still move a tenant of these steps: parked or migrated. */
  async hasTenantAwaitingRedrive({
    migrationNames,
  }: {
    migrationNames: readonly string[];
  }): Promise<boolean> {
    if (migrationNames.length === 0) return false;
    const table = await this.table();
    const { rows } = await this.postgres.query<{ found: number }>(
      `SELECT 1 AS "found" FROM ${table}
       WHERE "step_id" = ANY($1::text[]) AND "status" IN ('parked', 'migrated') LIMIT 1`,
      [[...migrationNames]],
    );
    return rows.length > 0;
  }

  /** Ops' rollup: how many tenants sit in each status for one step. */
  async findStatusCounts({
    migrationName,
  }: {
    migrationName: string;
  }): Promise<Record<TenantMigrationStatus, number>> {
    const table = await this.table();
    const { rows } = await this.postgres.query<{ status: string; count: string }>(
      `SELECT "status", count(*)::text AS "count" FROM ${table}
       WHERE "step_id" = $1 GROUP BY "status"`,
      [migrationName],
    );
    const counts: Record<TenantMigrationStatus, number> = {
      migrated: 0,
      finalized: 0,
      parked: 0,
      rolled_back: 0,
    };
    for (const row of rows) {
      const status = TENANT_MIGRATION_STATUSES.find((known) => known === row.status);
      if (status) counts[status] = Number(row.count);
    }
    return counts;
  }

  /** Ops' drill-down: tenants in these statuses, newest movement first; no step reads every one. */
  async findRecordsByStatus({
    migrationName,
    statuses,
    limit,
    offset = 0,
  }: {
    migrationName?: string | undefined;
    statuses: TenantMigrationStatus[];
    limit: number;
    offset?: number;
  }): Promise<TenantStepStateRow[]> {
    const table = await this.table();
    const { rows } = await this.postgres.query<
      StateRow & { step_id: string; tenant_id: string; updated_at_ms: string }
    >(
      `SELECT "step_id", "tenant_id", "status", "report", "held_reason",
        (extract(epoch FROM "updated_at") * 1000)::bigint::text AS "updated_at_ms",
        (extract(epoch FROM "held_since") * 1000)::bigint::text AS "held_since_ms"
       FROM ${table}
       WHERE ($1::text IS NULL OR "step_id" = $1) AND "status" = ANY($2::text[])
       ORDER BY "updated_at" DESC, "step_id" ASC, "tenant_id" ASC
       LIMIT $3 OFFSET $4`,
      [migrationName ?? null, [...statuses], limit, offset],
    );
    return rows.map((row) => ({
      ...recordOf({ migrationName: row.step_id, tenantId: row.tenant_id, row }),
      updatedAt: Temporal.Instant.fromEpochMilliseconds(Number(row.updated_at_ms)),
    }));
  }

  /** One statement, so the rolled-back check and the write cannot interleave with another. */
  private async write({
    record,
    unlessRolledBack,
  }: {
    record: TenantMigrationRecord;
    unlessRolledBack: boolean;
  }): Promise<boolean> {
    const table = await this.table();
    const guard = unlessRolledBack ? `WHERE current."status" <> 'rolled_back'` : "";
    const { rows } = await this.postgres.query<{ step_id: string }>(
      `INSERT INTO ${table} AS current
         ("step_id", "tenant_id", "status", "report", "held_reason", "held_since", "updated_at")
       VALUES ($1, $2, $3, $4::jsonb, $5, to_timestamp($6::double precision / 1000), now())
       ON CONFLICT ("step_id", "tenant_id") DO UPDATE SET
         "status" = EXCLUDED."status", "report" = EXCLUDED."report",
         "held_reason" = EXCLUDED."held_reason", "held_since" = EXCLUDED."held_since",
         "updated_at" = EXCLUDED."updated_at"
       ${guard}
       RETURNING "step_id"`,
      [
        record.migrationName,
        record.tenantId,
        record.status,
        record.report == null ? null : JSON.stringify(record.report),
        record.heldReason ?? null,
        record.heldSince?.epochMilliseconds ?? null,
      ],
    );
    return rows.length > 0;
  }

  private async table(): Promise<string> {
    const tables: LedgerTableNames = await ledgerTables({ postgres: this.postgres });
    return tables.tenantState;
  }
}

function recordOf({
  migrationName,
  tenantId,
  row,
}: {
  migrationName: string;
  tenantId: string;
  row: StateRow;
}): TenantMigrationRecord {
  const status = TENANT_MIGRATION_STATUSES.find((known) => known === row.status);
  if (!status) {
    throw new Error(`Tenant step "${migrationName}" holds unknown status "${row.status}".`);
  }
  const heldReason = HELD_REASONS.find((known) => known === row.held_reason);
  return {
    migrationName,
    tenantId,
    status,
    report: row.report,
    ...(heldReason ? { heldReason } : {}),
    ...(row.held_since_ms === null
      ? {}
      : { heldSince: Temporal.Instant.fromEpochMilliseconds(Number(row.held_since_ms)) }),
  };
}
