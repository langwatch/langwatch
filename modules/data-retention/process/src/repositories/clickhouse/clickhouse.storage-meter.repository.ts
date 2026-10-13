import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { PRODUCTION_STORAGE_METER_TABLES } from "@langwatch/data-retention-contract/retention-tables";
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

function parseTotal(rows: unknown): number {
  const parsed = storageMeterRowsSchema.parse(rows);
  const value = parsed[0]?.total ?? 0;
  const total = typeof value === "number" ? value : Number(value);

  return z.number().finite().nonnegative().parse(total);
}
