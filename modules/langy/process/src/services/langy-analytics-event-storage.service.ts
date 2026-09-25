import type { BulkAppendContext, ProjectionStoreContext } from "@langwatch/eventing";

import type { LangyAnalyticsEventProjectionRecord } from "../eventing/langy-analytics-event.projection.ts";
import type { LangyAnalyticsEventRepository } from "../repositories/langy-analytics-event.repository.ts";

export class LangyAnalyticsEventStorageService {
  private constructor(
    private readonly sink: LangyAnalyticsEventRepository,
    private readonly defaultRetentionDays: number,
  ) {}

  static create(input: {
    sink: LangyAnalyticsEventRepository;
    defaultRetentionDays: number;
  }): LangyAnalyticsEventStorageService {
    return new LangyAnalyticsEventStorageService(input.sink, input.defaultRetentionDays);
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
