import type { TraceAnalyticsRollupRow } from "../projections/trace-rollup.projection";

/**
 * @see ADR-034 Phase 1
 * Per-span insert into trace_analytics_rollup. The rollup is an AggregatingMergeTree with SimpleAggregateFunction(sum,...) columns, so the repository writes plain scalars (UInt64/Float64), no sumState binary states — each call appends one row per span's contribution, merged into one row per (TenantId, BucketStart, Model, SpanType). retentionDays (when given) stamps _retention_days; the table's TTL drops the row that many days after BucketStart.
 */
export abstract class TraceAnalyticsRollupRepository {
  abstract insertRow(row: TraceAnalyticsRollupRow, retentionDays?: number): Promise<void>;
  abstract insertRows(rows: TraceAnalyticsRollupRow[], retentionDays?: number): Promise<void>;
}

/** No-op implementation for tests and ClickHouse-less environments. */
export class NullTraceAnalyticsRollupRepository implements TraceAnalyticsRollupRepository {
  async insertRow(_row: TraceAnalyticsRollupRow, _retentionDays?: number): Promise<void> {
    // no-op: the Null repository intentionally discards rollup writes
  }

  async insertRows(_rows: TraceAnalyticsRollupRow[], _retentionDays?: number): Promise<void> {
    // no-op: the Null repository intentionally discards rollup writes
  }
}
