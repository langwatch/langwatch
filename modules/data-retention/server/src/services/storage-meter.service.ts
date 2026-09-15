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
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  RedisStorageMeterCacheStore,
  type StorageMeterRedis,
  type StorageMeterCacheStore,
} from "../stores/storage-meter-cache.store.ts";

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
    /** The process's one ClickHouse client, which routes each read itself. */
    clickhouse: ClickHouseQueryClient;
    redis?: StorageMeterRedis | null;
    now?: () => number;
    cache?: StorageMeterCacheStore;
  }): StorageMeterService {
    return new StorageMeterService(
      options.clickhouse,
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
    private readonly clickhouse: ClickHouseQueryClient,
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
    let firstFailure: unknown;
    let failures = 0;
    for (const table of PRODUCTION_STORAGE_METER_TABLES) {
      try {
        const { rows } = await this.clickhouse.query<unknown>({
          tenantId,
          table,
          kind: "read",
          sql: `SELECT sum(_size_bytes) AS total FROM ${table} WHERE TenantId = {tenantId:String}`,
          params: { tenantId },
          settings: METERING_CLICKHOUSE_SETTINGS,
        });
        const tableBytes = this.parseTotal(rows);
        const category = RETENTION_TABLE_CATEGORY_MAP[table];
        byCategory[category] += tableBytes;
      } catch (error) {
        failures += 1;
        firstFailure ??= error;
        logger.warn({ tenantId, table, error }, "Failed to query _size_bytes");
      }
    }

    // One table that would not answer is a gap in the breakdown. EVERY table
    // refusing is the store being unreachable, and reporting that as zero
    // bytes is the quiet downgrade: the caller caches it, the storage card
    // reads empty, and nothing says the number is not a measurement.
    if (failures === PRODUCTION_STORAGE_METER_TABLES.length) {
      throw firstFailure;
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
    const unions = PRODUCTION_STORAGE_METER_TABLES.map(
      (table) => `SELECT sum(_size_bytes) AS t FROM ${table} WHERE TenantId = {tenantId:String}`,
    ).join("\n  UNION ALL\n  ");

    try {
      const { rows } = await this.clickhouse.query<unknown>({
        tenantId,
        kind: "read",
        sql: `SELECT sum(t) AS total FROM (\n  ${unions}\n)`,
        params: { tenantId },
        settings: METERING_CLICKHOUSE_SETTINGS,
      });

      return this.parseTotal(rows);
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
