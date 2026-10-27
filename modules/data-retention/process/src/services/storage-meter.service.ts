import {
  storageMeterTenantInputSchema,
  storageMeterTenantsInputSchema,
} from "@langwatch/data-retention-contract";
import {
  RETENTION_TABLE_CATEGORY_MAP,
  PRODUCTION_STORAGE_METER_TABLES,
} from "@langwatch/data-retention-contract/retention-tables";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type { StorageMeterCacheRepository } from "../repositories/storage-meter-cache.repository.ts";
import type { StorageMeterRepository } from "../repositories/storage-meter.repository.ts";

const logger = createLogger("langwatch:data-retention:metering");
const STORAGE_FRESH_MS = 5 * 60 * 1_000;
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
    /** What each tenant holds on disk, read from the store that holds it. */
    meter: StorageMeterRepository;
    cache: StorageMeterCacheRepository;
    now?: () => number;
  }): StorageMeterService {
    return new StorageMeterService(options.meter, options.cache, options.now ?? Date.now);
  }

  private constructor(
    private readonly meter: StorageMeterRepository,
    private readonly cache: StorageMeterCacheRepository,
    private readonly now: () => number,
  ) {}

  async getTotalStorageBytes(input: { tenantId: string }): Promise<number> {
    const { tenantId } = storageMeterTenantInputSchema.parse(input);
    const cached = await this.cache.get(tenantId);
    if (cached.kind === "hit") {
      const entry = cached.value;
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
        const tableBytes = await this.meter.getTableBytes({ tenantId, table });
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
    try {
      return await this.meter.getTenantBytes({ tenantId });
    } catch (error) {
      logger.warn(
        { tenantId, error },
        "Total _size_bytes query failed; falling back to per-table breakdown",
      );
      const breakdown = await this.getStorageBreakdown({ tenantId });

      return breakdown.totalBytes;
    }
  }
}
