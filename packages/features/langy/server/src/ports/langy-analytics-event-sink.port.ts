import type { LangyAnalyticsEventProjectionRecord } from "../projections/langy-analytics-event.projection";

export type LangyAnalyticsEventRecord = {
  tenantId: string;
} & LangyAnalyticsEventProjectionRecord;

export abstract class LangyAnalyticsEventSinkPort {
  abstract insert(
    record: LangyAnalyticsEventRecord,
    retentionDays: number,
  ): Promise<void>;

  abstract insertBatch(
    records: LangyAnalyticsEventRecord[],
    retentionDays: number,
  ): Promise<void>;
}
