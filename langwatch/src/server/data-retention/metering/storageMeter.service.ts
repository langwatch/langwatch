import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "~/utils/logger/server";
import { type RetentionCategory } from "../retentionPolicy.schema";

const logger = createLogger("langwatch:data-retention:metering");

interface StorageBreakdown {
  totalBytes: number;
  byCategory: Record<RetentionCategory, number>;
}

const EMPTY_BREAKDOWN: StorageBreakdown = {
  totalBytes: 0,
  byCategory: { traces: 0, scenarios: 0, experiments: 0 },
};

/**
 * Storage metering is currently a no-op. The previous implementation summed a
 * `_size_bytes` MATERIALIZED `byteSize(<payload columns>)` column added in
 * ClickHouse migration 00032; that column was dropped in 00033 because the
 * byteSize() expression evaluated during background merges on heavy-payload
 * tables and pushed merges over the per-server memory cap.
 *
 * Returning zero from this surface keeps the data-retention settings page
 * (the only consumer) from breaking while a replacement metering strategy
 * lands. The replacement will not require per-row materialization.
 */
export class StorageMeterService {
  constructor(
    private readonly resolveClickHouseClient: ClickHouseClientResolver | null,
  ) {}

  async getTotalStorageBytes({ tenantId }: { tenantId: string }): Promise<number> {
    if (!this.resolveClickHouseClient) return 0;
    logger.debug({ tenantId }, "Storage metering temporarily disabled");
    return 0;
  }

  async getStorageBreakdown({ tenantId }: { tenantId: string }): Promise<StorageBreakdown> {
    if (!this.resolveClickHouseClient) return EMPTY_BREAKDOWN;
    logger.debug({ tenantId }, "Storage breakdown temporarily disabled");
    return EMPTY_BREAKDOWN;
  }
}
