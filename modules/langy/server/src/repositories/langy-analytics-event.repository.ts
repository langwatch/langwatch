import type { LangyAnalyticsEventProjectionRecord } from "../projections/langy-analytics-event.projection.ts";

export type LangyAnalyticsEventRecord = {
  tenantId: string;
} & LangyAnalyticsEventProjectionRecord;

/**
 * Where one conversation's analytics rows land. A seam because the store is a
 * deployment choice: ClickHouse holds them where the deployment has one, and
 * a process without it keeps them in memory rather than pretending to write.
 * The retention days travel with each write because the tenant's policy, not
 * the table, decides how long a row lives.
 */
export abstract class LangyAnalyticsEventSink {
  /** One row, written on the tenant's retention. */
  abstract insert(record: LangyAnalyticsEventRecord, retentionDays: number): Promise<void>;

  /** A whole fold's rows in one round trip. An empty batch writes nothing. */
  abstract insertBatch(records: LangyAnalyticsEventRecord[], retentionDays: number): Promise<void>;
}
