import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import {
  storageMeterTenantInputSchema,
  storageMeterTenantsInputSchema,
} from "@langwatch/data-retention-contract";
import {
  RETENTION_TABLE_CATEGORY_MAP,
  PRODUCTION_STORAGE_METER_TABLES,
} from "@langwatch/data-retention-contract/retention-tables";
import type { StorageMeterClickHouseResolver } from "../ports/storage-meter-clickhouse.port";
import {
  RedisStorageMeterCacheStore,
  type StorageMeterRedis,
  type StorageMeterCacheStore,
} from "../stores/storage-meter-cache.store";

const logger = createLogger("langwatch:data-retention:metering");
const STORAGE_FRESH_MS = 5 * 60 * 1_000;
const STORAGE_HARD_TTL_MS = 30 * 60 * 1_000;
const METERING_MAX_EXECUTION_SECONDS = 45;
const METERING_CLICKHOUSE_SETTINGS = {
  max_threads: 2,
  max_execution_time: METERING_MAX_EXECUTION_SECONDS,
} as const;

const storageMeterRowSchema = z
  .object({ total: z.union([z.string(), z.number()]).nullable().optional() })
  .strict();

const storageBreakdownSchema = z
  .object({
    totalBytes: z.number().finite().nonnegative(),
    byCategory: z
      .object({
        traces: z.number().finite().nonnegative(),
        scenarios: z.number().finite().nonnegative(),
        experiments: z.number().finite().nonnegative(),
      })
      .strict(),
  })
  .strict();

type StorageBreakdown = z.infer<typeof storageBreakdownSchema>;

type StorageMeterCategoryTotals = {
  traces: number;
  scenarios: number;
  experiments: number;
};

export class StorageMeterService {
  static create(options: {
    resolveClickHouseClient: StorageMeterClickHouseResolver | null;
    redis?: StorageMeterRedis | null;
    now?: () => number;
    cache?: StorageMeterCacheStore;
  }): StorageMeterService {
    return new StorageMeterService(
      options.resolveClickHouseClient,
      options.cache ??
        RedisStorageMeterCacheStore.create({
          redis: options.redis,
          ttlMs: STORAGE_HARD_TTL_MS,
          now: options.now,
        }),
      options.now ?? Date.now,
    );
  }

  private constructor(
    private readonly resolveClickHouseClient: StorageMeterClickHouseResolver | null,
    private readonly cache: StorageMeterCacheStore,
    private readonly now: () => number,
  ) {}

  async getTotalStorageBytes(input: { tenantId: string }): Promise<number> {
    const { tenantId } = storageMeterTenantInputSchema.parse(input);
    const entry = await this.cache.tryGet(tenantId);
    if (entry !== void 0) {
      if (this.now() - entry.computedAt >= STORAGE_FRESH_MS) {
        void this.refreshInBackground(tenantId);
      }
      return entry.bytes;
    }

    try {
      return await this.computeAndStore(tenantId);
    } catch (error) {
      logger.warn(
        { tenantId, error },
        "Cold storage read failed; caching degraded 0 (self-heals on next read)",
      );
      await this.cache.set(tenantId, {
        bytes: 0,
        computedAt: this.now() - STORAGE_FRESH_MS,
      });
      return 0;
    }
  }

  async getTotalStorageBytesForTenants(input: { tenantIds: string[] }): Promise<number> {
    const { tenantIds } = storageMeterTenantsInputSchema.parse(input);
    const unique = Array.from(new Set(tenantIds));
    if (unique.length === 0) {
      return 0;
    }

    const concurrency = 8;
    let total = 0;
    for (let i = 0; i < unique.length; i += concurrency) {
      const batch = unique.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((tenantId) =>
          this.getTotalStorageBytes({ tenantId }).catch((error) => {
            logger.warn(
              { tenantId, error },
              "Per-tenant storage read failed in scope aggregation; counting 0",
            );
            return 0;
          }),
        ),
      );
      total += results.reduce((sum, value) => sum + value, 0);
    }
    return total;
  }

  async getStorageBreakdown(input: { tenantId: string }): Promise<StorageBreakdown> {
    const { tenantId } = storageMeterTenantInputSchema.parse(input);
    const byCategory: StorageMeterCategoryTotals = {
      traces: 0,
      scenarios: 0,
      experiments: 0,
    };
    if (!this.resolveClickHouseClient) {
      return storageBreakdownSchema.parse({ totalBytes: 0, byCategory });
    }

    const client = await this.resolveClickHouseClient(tenantId);
    for (const table of PRODUCTION_STORAGE_METER_TABLES) {
      try {
        const result = await client.query({
          query: `SELECT sum(_size_bytes) AS total FROM ${table} WHERE TenantId = {tenantId:String}`,
          query_params: { tenantId },
          format: "JSONEachRow",
          clickhouse_settings: METERING_CLICKHOUSE_SETTINGS,
        });
        const tableBytes = this.parseTotal(await result.json());
        const category = RETENTION_TABLE_CATEGORY_MAP[table];
        byCategory[category] += tableBytes;
      } catch (error) {
        logger.warn({ tenantId, table, error }, "Failed to query _size_bytes");
      }
    }

    return storageBreakdownSchema.parse({
      totalBytes: Object.values(byCategory).reduce((sum, value) => sum + value, 0),
      byCategory,
    });
  }

  private async computeAndStore(tenantId: string): Promise<number> {
    const bytes = await this.queryTotalBytes(tenantId);
    await this.cache.set(tenantId, { bytes, computedAt: this.now() });
    return bytes;
  }

  private async refreshInBackground(tenantId: string): Promise<void> {
    if (!(await this.cache.claim(tenantId, this.now()))) {
      return;
    }

    try {
      await this.computeAndStore(tenantId);
    } catch (error) {
      logger.warn(
        { tenantId, error },
        "Background storage refresh failed; keeping last good value",
      );
    }
  }

  private async queryTotalBytes(tenantId: string): Promise<number> {
    if (!this.resolveClickHouseClient) {
      return 0;
    }

    const client = await this.resolveClickHouseClient(tenantId);
    const unions = PRODUCTION_STORAGE_METER_TABLES.map(
      (table) => `SELECT sum(_size_bytes) AS t FROM ${table} WHERE TenantId = {tenantId:String}`,
    ).join("\n  UNION ALL\n  ");

    try {
      const result = await client.query({
        query: `SELECT sum(t) AS total FROM (\n  ${unions}\n)`,
        query_params: { tenantId },
        format: "JSONEachRow",
        clickhouse_settings: METERING_CLICKHOUSE_SETTINGS,
      });
      return this.parseTotal(await result.json());
    } catch (error) {
      logger.warn(
        { tenantId, error },
        "Total _size_bytes query failed; falling back to per-table breakdown",
      );
      const breakdown = await this.getStorageBreakdown({ tenantId });
      return breakdown.totalBytes;
    }
  }

  private parseTotal(rows: unknown): number {
    const parsed = z.array(storageMeterRowSchema).parse(rows);
    const value = parsed[0]?.total ?? 0;
    const total = typeof value === "number" ? value : Number(value);
    return z.number().finite().nonnegative().parse(total);
  }
}
