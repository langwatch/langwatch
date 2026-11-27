import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { PRODUCTION_STORAGE_METER_TABLES } from "@langwatch/data-retention-contract/retention-tables";
import { EVENT_TABLES } from "@langwatch/eventing/tables";
import { z } from "zod";

import type { StorageMeterRepository, StorageMeterTable } from "../storage-meter.repository.ts";

const METERING_MAX_EXECUTION_SECONDS = 45;
const METERING_CLICKHOUSE_SETTINGS = {
  max_threads: 2,
  max_execution_time: METERING_MAX_EXECUTION_SECONDS,
} as const;

const storageMeterRowSchema = z
  .object({ total: z.union([z.string(), z.number()]).nullable().optional() })
  .strict();

const storageMeterRowsSchema = z.array(storageMeterRowSchema);

/** `_size_bytes` sums over the process's one ClickHouse client, which routes each read itself. */
export class ClickHouseStorageMeterRepository implements StorageMeterRepository {
  static create(options: { clickhouse: ClickHouseQueryClient }): ClickHouseStorageMeterRepository {
    return new ClickHouseStorageMeterRepository(options.clickhouse);
  }

  private constructor(private readonly clickhouse: ClickHouseQueryClient) {}

  async getTenantBytes({ tenantId }: { tenantId: string }): Promise<number> {
    const unions = PRODUCTION_STORAGE_METER_TABLES.map(
      (table) => `SELECT sum(_size_bytes) AS t FROM ${table} WHERE TenantId = {tenantId:String}`,
    ).join("\n  UNION ALL\n  ");
    const { rows } = await this.clickhouse.query<unknown>({
      tenantId,
      kind: "read",
      sql: `SELECT sum(t) AS total FROM (\n  ${unions}\n)`,
      params: { tenantId },
      settings: METERING_CLICKHOUSE_SETTINGS,
    });

    return parseTotal(rows);
  }

  async getTenantBytesBefore({
    tenantId,
    beforeMs,
  }: {
    tenantId: string;
    beforeMs: number;
  }): Promise<number> {
    const unions = PRODUCTION_STORAGE_METER_TABLES.map(
      (table) =>
        `SELECT sum(_size_bytes) AS t FROM ${table} WHERE TenantId = {tenantId:String} AND ${rowTimeBefore(table)}`,
    ).join("\n  UNION ALL\n  ");
    const { rows } = await this.clickhouse.query<unknown>({
      tenantId,
      kind: "read",
      sql: `SELECT sum(t) AS total FROM (\n  ${unions}\n)`,
      params: { tenantId, beforeMs },
      settings: METERING_CLICKHOUSE_SETTINGS,
    });

    return parseTotal(rows);
  }

  async getTableBytes({
    tenantId,
    table,
  }: {
    tenantId: string;
    table: StorageMeterTable;
  }): Promise<number> {
    const { rows } = await this.clickhouse.query<unknown>({
      tenantId,
      table,
      kind: "read",
      sql: `SELECT sum(_size_bytes) AS total FROM ${table} WHERE TenantId = {tenantId:String}`,
      params: { tenantId },
      settings: METERING_CLICKHOUSE_SETTINGS,
    });

    return parseTotal(rows);
  }
}

/** Eventing's event log, keyed from its own table list. */
const EVENT_LOG = EVENT_TABLES[0].table;

/**
 * The column each metered table is partitioned by, so a time filter prunes whole weekly parts.
 * An integration test holds this against every table's partition key.
 */
export const STORAGE_METER_ROW_TIME: Readonly<Partial<Record<StorageMeterTable, string>>> = {
  dspy_steps: "CreatedAt",
  evaluation_runs: "ScheduledAt",
  [EVENT_LOG]: "EventOccurredAt",
  experiment_run_items: "OccurredAt",
  experiment_runs: "StartedAt",
  langy_analytics_events: "OccurredAt",
  log_records: "TimeUnixMs",
  stored_log_records: "TimeUnixMs",
  simulation_runs: "StartedAt",
  suite_runs: "StartedAt",
  stored_spans: "StartTime",
  trace_summaries: "OccurredAt",
};

/** The event log keeps its time as epoch milliseconds; every other table as DateTime64(3). */
const EPOCH_MS_ROW_TIME_TABLES = new Set<string>([EVENT_LOG]);

function rowTimeBefore(table: StorageMeterTable): string {
  const column = STORAGE_METER_ROW_TIME[table];
  if (!column) throw new Error(`Storage meter has no row time column for ${table}`);
  return EPOCH_MS_ROW_TIME_TABLES.has(table)
    ? `${column} < {beforeMs:UInt64}`
    : `${column} < fromUnixTimestamp64Milli({beforeMs:Int64})`;
}

function parseTotal(rows: unknown): number {
  const parsed = storageMeterRowsSchema.parse(rows);
  const value = parsed[0]?.total ?? 0;
  const total = typeof value === "number" ? value : Number(value);

  return z.number().finite().nonnegative().parse(total);
}
