import type { AppendStore, BulkAppendContext, ProjectionStoreContext } from "@langwatch/eventing";

import type { SpanAnalyticsRepository } from "../repositories/span-analytics.repository.ts";
import type { SpanAnalyticsRow } from "./span-analytics.projection.ts";

/**
 * AppendStore adapter for the spanAnalytics map projection: stamps the tenant's trace retention
 * onto `_retention_days`, as stored_spans does, then delegates to the repository.
 */
export class SpanAnalyticsStore implements AppendStore<SpanAnalyticsRow> {
  private constructor(
    private readonly storage: SpanAnalyticsRepository,
    private readonly defaultRetentionDays: () => number,
  ) {}

  static create(options: {
    storage: SpanAnalyticsRepository;
    defaultRetentionDays: () => number;
  }): SpanAnalyticsStore {
    return new SpanAnalyticsStore(options.storage, options.defaultRetentionDays);
  }

  async append(record: SpanAnalyticsRow, context: ProjectionStoreContext): Promise<void> {
    await this.storage.insertRows({
      rows: [record],
      retentionDays: context.retentionPolicy?.traces ?? this.defaultRetentionDays(),
    });
  }

  async bulkAppend(records: SpanAnalyticsRow[], context: BulkAppendContext): Promise<void> {
    await this.storage.insertRows({
      rows: records,
      retentionDays: context.retentionPolicy?.traces ?? this.defaultRetentionDays(),
    });
  }
}
