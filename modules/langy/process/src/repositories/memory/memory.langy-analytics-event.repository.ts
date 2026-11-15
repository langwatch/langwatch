import {
  LangyAnalyticsEventRepository,
  type LangyAnalyticsEventRecord,
} from "../langy-analytics-event.repository.ts";
import type { LangyMemoryStore } from "./langy-memory.store.ts";

/**
 * The analytics rows a process without ClickHouse keeps. They are held rather
 * than dropped so a test can read back what the fold wrote.
 */
export class LangyAnalyticsEventMemoryRepository extends LangyAnalyticsEventRepository {
  private constructor(private readonly store: LangyMemoryStore) {
    super();
  }

  static create(store: LangyMemoryStore): LangyAnalyticsEventMemoryRepository {
    return new LangyAnalyticsEventMemoryRepository(store);
  }

  async insert(record: LangyAnalyticsEventRecord): Promise<void> {
    this.store.analyticsEvents.push(record);
  }

  async insertBatch(records: LangyAnalyticsEventRecord[]): Promise<void> {
    this.store.analyticsEvents.push(...records);
  }

  /** The tenant's held rows' JSON byte length, standing in for `_size_bytes`. */
  async getStoredBytes({ tenantId }: { tenantId: string }): Promise<number> {
    let total = 0;
    for (const record of this.store.analyticsEvents) {
      if (record.tenantId === tenantId) total += Buffer.byteLength(JSON.stringify(record));
    }
    return total;
  }
}
