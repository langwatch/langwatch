import type { SpanAnalyticsRow } from "../eventing/span-analytics.projection.ts";

/** Private persistence capability for the span_analytics map projection. */
export abstract class SpanAnalyticsRepository {
  /** Appends one tenant's rows; a batch mixing tenants is refused. */
  abstract insertRows(input: { rows: SpanAnalyticsRow[]; retentionDays: number }): Promise<void>;
}
