import type { BulkAppendContext, ProjectionStoreContext } from "@langwatch/eventing";
import type { LangyAnalyticsEventProjectionRecord } from "../projections/langy-analytics-event.projection";
import { LangyAnalyticsEventSinkPort } from "../ports/langy-analytics-event-sink.port";

export class LangyAnalyticsEventStorageAdapter {
  private constructor(
    private readonly sink: LangyAnalyticsEventSinkPort,
    private readonly defaultRetentionDays: number,
  ) {}

  static create(input: {
    sink: LangyAnalyticsEventSinkPort;
    defaultRetentionDays: number;
  }): LangyAnalyticsEventStorageAdapter {
    return new LangyAnalyticsEventStorageAdapter(input.sink, input.defaultRetentionDays);
  }

  async append(
    record: LangyAnalyticsEventProjectionRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.sink.insert(
      { tenantId: String(context.tenantId), ...record },
      context.retentionPolicy?.traces ?? this.defaultRetentionDays,
    );
  }

  async bulkAppend(
    records: LangyAnalyticsEventProjectionRecord[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const tenantId = String(context.tenantId);
    await this.sink.insertBatch(
      records.map((record) => ({ tenantId, ...record })),
      context.retentionPolicy?.traces ?? this.defaultRetentionDays,
    );
  }
}

export class NullLangyAnalyticsEventSinkAdapter extends LangyAnalyticsEventSinkPort {
  private constructor() {
    super();
  }

  static create(): NullLangyAnalyticsEventSinkAdapter {
    return new NullLangyAnalyticsEventSinkAdapter();
  }

  async insert(): Promise<void> {}

  async insertBatch(): Promise<void> {}
}
