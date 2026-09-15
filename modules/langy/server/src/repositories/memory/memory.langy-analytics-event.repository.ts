import {
  LangyAnalyticsEventSink,
  type LangyAnalyticsEventRecord,
} from "../langy-analytics-event.repository.ts";
import type { LangyMemoryStore } from "./langy-memory.store.ts";

/**
 * The analytics rows a process without ClickHouse keeps. They are held rather
 * than dropped so a test can read back what the fold wrote.
 */
export class LangyAnalyticsEventMemoryRepository extends LangyAnalyticsEventSink {
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
}
