import {
  storageMeterTenantInputSchema,
  storageMeterTenantsInputSchema,
} from "@langwatch/data-retention-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type { StoredBytesOwners } from "../channels/data-retention.channels.ts";
import type { StorageMeterCacheRepository } from "../repositories/storage-meter-cache.repository.ts";
import type { StorageMeterRepository } from "../repositories/storage-meter.repository.ts";

const logger = createLogger("langwatch:data-retention:metering");
const STORAGE_FRESH_MS = 5 * 60 * 1_000;
const storedBytesSchema = z.number().finite().nonnegative();

export class StorageMeterService {
  static create(options: {
    /** Each module owning metered tables, asked for its own stored bytes (ADR-202 Decided 20). */
    owners: StoredBytesOwners;
    /** The event log's bytes, which the framework owns (ADR-202 Decided 22). */
    eventLog: StorageMeterRepository;
    cache: StorageMeterCacheRepository;
    now?: () => number;
  }): StorageMeterService {
    return new StorageMeterService({ ...options, now: options.now ?? Date.now });
  }

  private readonly owners: StoredBytesOwners;
  private readonly eventLog: StorageMeterRepository;
  private readonly cache: StorageMeterCacheRepository;
  private readonly now: () => number;

  private constructor(options: {
    owners: StoredBytesOwners;
    eventLog: StorageMeterRepository;
    cache: StorageMeterCacheRepository;
    now: () => number;
  }) {
    this.owners = options.owners;
    this.eventLog = options.eventLog;
    this.cache = options.cache;
    this.now = options.now;
  }

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

  /**
   * One owner that cannot answer is a gap in the total, logged by name. Every owner refusing is
   * the store being unreachable: reporting that as zero bytes would be cached as a measurement.
   */
  private async queryTotalBytes(tenantId: string): Promise<number> {
    const sources = [
      ...Object.entries(this.owners).map(([owner, api]) => ({
        owner,
        read: () => api.getStoredBytes({ projectId: tenantId }),
      })),
      { owner: "eventing", read: () => this.eventLog.getEventLogBytes({ tenantId }) },
    ];
    const results = await Promise.allSettled(sources.map((source) => source.read()));
    let total = 0;
    let answered = 0;
    let firstFailure: unknown;
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        total += storedBytesSchema.parse(result.value);
        answered += 1;
        return;
      }
      firstFailure ??= result.reason;
      logger.warn(
        { tenantId, owner: sources[index]?.owner, error: result.reason },
        "An owner could not report its stored bytes; left out of the total",
      );
    });
    if (answered === 0) {
      throw firstFailure;
    }

    return total;
  }
}
