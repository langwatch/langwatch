import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { TtlCache } from "~/server/utils/ttlCache";
import { createLogger } from "~/utils/logger/server";
import {
  RETENTION_MANAGED_TABLES,
  RETENTION_TABLE_CATEGORY_MAP,
  type RetentionCategory,
} from "../retentionPolicy.schema";

const logger = createLogger("langwatch:data-retention:metering");

const CACHE_TTL_MS = 5 * 60 * 1000;

// Storage metering sums `_size_bytes`, a `UInt32 MATERIALIZED byteSize(...)`
// column over each table's payload columns. On parts written before that
// column existed, ClickHouse has no stored value and recomputes it lazily on
// read by scanning the heavy source columns (Messages.*, Inputs, Details,
// EventPayload, ...). Summing across a large tenant therefore reads those
// payload columns for every row; at the default thread count the parallel
// per-stream column buffers exceeded the per-query memory limit (Code 241,
// e.g. ~6.6 GiB reading column `Inputs` against the 3.5 GiB cap), so the
// metering read failed outright.
//
// These are cached (5 min), background metering reads, so we trade parallelism
// for a bounded peak: capping the read streams keeps the recompute's footprint
// well under the per-query limit so the query succeeds, and lowers its share of
// total server memory so it can't help tip the box into a server-wide OOM. The
// common case (parts where `_size_bytes` is already materialized) reads a tiny
// UInt32 column and is unaffected.
const METERING_CLICKHOUSE_SETTINGS = {
  max_threads: 2,
} as const;

interface StorageBreakdown {
  totalBytes: number;
  byCategory: Record<RetentionCategory, number>;
}

export class StorageMeterService {
  private readonly cache: TtlCache<number>;

  constructor(
    private readonly resolveClickHouseClient: ClickHouseClientResolver | null,
  ) {
    this.cache = new TtlCache(CACHE_TTL_MS, "storage-meter:");
  }

  async getTotalStorageBytes({
    tenantId,
  }: {
    tenantId: string;
  }): Promise<number> {
    const cached = await this.cache.get(tenantId);
    if (cached !== undefined) return cached;

    const total = await this.queryTotalBytes(tenantId);
    await this.cache.set(tenantId, total);
    return total;
  }

  async getStorageBreakdown({
    tenantId,
  }: {
    tenantId: string;
  }): Promise<StorageBreakdown> {
    if (!this.resolveClickHouseClient) {
      return {
        totalBytes: 0,
        byCategory: { traces: 0, scenarios: 0, experiments: 0 },
      };
    }

    const client = await this.resolveClickHouseClient(tenantId);
    const byCategory: Record<RetentionCategory, number> = {
      traces: 0,
      scenarios: 0,
      experiments: 0,
    };

    for (const table of RETENTION_MANAGED_TABLES) {
      try {
        const result = await client.query({
          query: `SELECT sum(_size_bytes) AS total FROM ${table} WHERE TenantId = {tenantId:String}`,
          query_params: { tenantId },
          format: "JSONEachRow",
          clickhouse_settings: METERING_CLICKHOUSE_SETTINGS,
        });
        const rows = (await result.json()) as Array<{ total: string }>;
        const tableBytes = Number(rows[0]?.total ?? 0);
        const category = RETENTION_TABLE_CATEGORY_MAP[table]!;
        byCategory[category] += tableBytes;
      } catch (error) {
        logger.warn({ tenantId, table, error }, "Failed to query _size_bytes");
      }
    }

    const totalBytes = Object.values(byCategory).reduce((a, b) => a + b, 0);
    return { totalBytes, byCategory };
  }

  private async queryTotalBytes(tenantId: string): Promise<number> {
    if (!this.resolveClickHouseClient) return 0;

    const client = await this.resolveClickHouseClient(tenantId);
    // Aggregate per-table first, then sum the 11 scalars. The naive
    // UNION ALL on raw rows materializes every _size_bytes value into the
    // intermediate set before summing — explodes memory for tenants with
    // tens of millions of rows.
    const unions = RETENTION_MANAGED_TABLES.map(
      (table) =>
        `SELECT sum(_size_bytes) AS t FROM ${table} WHERE TenantId = {tenantId:String}`,
    ).join("\n  UNION ALL\n  ");

    const result = await client.query({
      query: `SELECT sum(t) AS total FROM (\n  ${unions}\n)`,
      query_params: { tenantId },
      format: "JSONEachRow",
      clickhouse_settings: METERING_CLICKHOUSE_SETTINGS,
    });
    const rows = (await result.json()) as Array<{ total: string }>;
    return Number(rows[0]?.total ?? 0);
  }
}
