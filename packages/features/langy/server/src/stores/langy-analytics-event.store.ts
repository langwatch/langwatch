import type {
  AppendStore,
  BulkAppendContext,
  ProjectionStoreContext,
} from "@langwatch/eventing";
import type { LangyAnalyticsEventProjectionRecord } from "../projections/langy-analytics-event.projection";

interface LangyAnalyticsEventSink {
  insert(
    record: { tenantId: string } & LangyAnalyticsEventProjectionRecord,
    retentionDays: number,
  ): Promise<void>;

  insertBatch(
    records: Array<{ tenantId: string } & LangyAnalyticsEventProjectionRecord>,
    retentionDays: number,
  ): Promise<void>;
}

/** App-layer adapter for the analytics-only ClickHouse event sink. */
export class LangyAnalyticsEventAppendStore
  implements AppendStore<LangyAnalyticsEventProjectionRecord>
{
  constructor(
    private readonly repository: LangyAnalyticsEventSink,
    private readonly defaultRetentionDays: number,
  ) {}

  async append(
    record: LangyAnalyticsEventProjectionRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repository.insert(
      { tenantId: String(context.tenantId), ...record },
      context.retentionPolicy?.traces ?? this.defaultRetentionDays,
    );
  }

  async bulkAppend(
    records: LangyAnalyticsEventProjectionRecord[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) return;
    const tenantId = String(context.tenantId);
    await this.repository.insertBatch(
      records.map((record) => ({ tenantId, ...record })),
      context.retentionPolicy?.traces ?? this.defaultRetentionDays,
    );
  }
}
