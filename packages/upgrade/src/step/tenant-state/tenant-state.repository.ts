import {
  HELD_REASONS,
  SystemMigrationRecordNotFoundError,
  type SystemMigrationStateRepository,
  TENANT_MIGRATION_STATUSES,
  type TenantMigrationRecord,
} from "@langwatch/system-migrations";
import { Temporal } from "@langwatch/time";

import { type LedgerTableNames, ledgerTables } from "../../ledger-tables.ts";
import type { UpgradePostgres } from "../../ports.ts";

/** Marks the SQL for the tenancy guard: the ledger describes the installation's upgrade. */
const TENANCY =
  "-- @tenancy: per-tenant step state belongs to the installation's upgrade ledger.\n";

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
      `${TENANCY}SELECT "status", "report", "held_reason",
        (extract(epoch FROM "held_since") * 1000)::bigint::text AS "held_since_ms"
       FROM ${table} WHERE "step_id" = $1 AND "tenant_id" = $2`,
      [migrationName, tenantId],
    );
    const row = rows[0];
    if (!row) throw new SystemMigrationRecordNotFoundError({ migrationName, tenantId });
    return recordOf({ migrationName, tenantId, row });
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
      `${TENANCY}SELECT 1 AS "found" FROM ${table}
       WHERE "step_id" = $1 AND "status" = 'finalized' LIMIT 1`,
      [migrationName],
    );
    return rows.length > 0;
  }

  /** A tenant the step has parked or holds (its proof disagreed, or its queued work waits). */
  async hasUnsettledTenant({ migrationName }: { migrationName: string }): Promise<boolean> {
    const table = await this.table();
    const { rows } = await this.postgres.query<{ found: number }>(
      `${TENANCY}SELECT 1 AS "found" FROM ${table}
       WHERE "step_id" = $1 AND ("status" = 'parked' OR "held_reason" IS NOT NULL) LIMIT 1`,
      [migrationName],
    );
    return rows.length > 0;
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
      `${TENANCY}INSERT INTO ${table} AS current
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
