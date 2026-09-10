import type { TraceAnalyticsRollupRow } from "../../projections/trace-rollup.projection.ts";

/** Private persistence capability for the trace_analytics_rollup projection. */
export abstract class TraceAnalyticsRollupRepository {
  abstract insertRow(input: { row: TraceAnalyticsRollupRow; retentionDays: number }): Promise<void>;

  abstract insertRows(input: {
    rows: TraceAnalyticsRollupRow[];
    retentionDays: number;
  }): Promise<void>;
}
