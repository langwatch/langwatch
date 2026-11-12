import type { SpanAnalyticsRow } from "../eventing/span-analytics.projection.ts";

/** A span's identity within a tenant. */
export interface SpanAnalyticsKey {
  traceId: string;
  spanId: string;
}

/** Private persistence capability for the span_analytics map projection. */
export abstract class SpanAnalyticsRepository {
  /** Appends one tenant's rows; a batch mixing tenants is refused. */
  abstract insertRows(input: { rows: SpanAnalyticsRow[]; retentionDays: number }): Promise<void>;

  /** The (traceId, spanId) pairs of `keys` stored for the tenant with a StartTime in the bound. */
  abstract existingSpanKeys(input: {
    tenantId: string;
    keys: SpanAnalyticsKey[];
    startTimeFromMs: number;
    startTimeToMs: number;
  }): Promise<SpanAnalyticsKey[]>;
}
