import type { LangyAnalyticsEventProjectionRecord } from "../eventing/langy-analytics-event.projection.ts";

export type LangyAnalyticsEventRecord = {
  tenantId: string;
} & LangyAnalyticsEventProjectionRecord;

/**
 * Where one conversation's analytics rows land. A seam because the store
 * is a deployment choice: ClickHouse where the deployment has one, memory
 * otherwise. Retention days travel with each write; the tenant decides.
 */
export abstract class LangyAnalyticsEventRepository {
  /** One row, written on the tenant's retention. */
  abstract insert(record: LangyAnalyticsEventRecord, retentionDays: number): Promise<void>;

  /** A whole fold's rows in one round trip. An empty batch writes nothing. */
  abstract insertBatch(records: LangyAnalyticsEventRecord[], retentionDays: number): Promise<void>;
}
