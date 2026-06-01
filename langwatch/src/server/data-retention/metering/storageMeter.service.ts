import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { TtlCache } from "~/server/utils/ttlCache";
import { RETENTION_MANAGED_TABLES, RETENTION_TABLE_CATEGORY_MAP, type RetentionCategory } from "../retentionPolicy.schema";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:data-retention:metering");

const CACHE_TTL_MS = 5 * 60 * 1000;

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
      return { totalBytes: 0, byCategory: { traces: 0, scenarios: 0, experiments: 0 } };
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
    });
    const rows = (await result.json()) as Array<{ total: string }>;
    return Number(rows[0]?.total ?? 0);
  }
}
