import type { TraceAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceAnalyticsRollup.mapProjection";

/**
 * Per-span insert into `trace_analytics_rollup` (ADR-034 Phase 1).
 *
 * The rollup is an AggregatingMergeTree with `SimpleAggregateFunction(sum, ...)`
 * columns, so the repository writes plain scalar values (a UInt64, a Float64)
 * — no sumState binary states. Each call appends a single row representing one
 * span's contribution; merges roll the rows up into one row per
 * (TenantId, BucketStart, Model, SpanType).
 *
 * `retentionDays` (when provided) is stamped onto the row's `_retention_days`
 * column; the table's TTL drops the row that many days after its `BucketStart`.
 */
export interface TraceAnalyticsRollupRepository {
  insertRow(row: TraceAnalyticsRollupRow, retentionDays?: number): Promise<void>;
  insertRows(rows: TraceAnalyticsRollupRow[], retentionDays?: number): Promise<void>;
}

/** No-op implementation for tests and ClickHouse-less environments. */
export class NullTraceAnalyticsRollupRepository
  implements TraceAnalyticsRollupRepository
{
  async insertRow(
    _row: TraceAnalyticsRollupRow,
    _retentionDays?: number,
  ): Promise<void> {}

  async insertRows(
    _rows: TraceAnalyticsRollupRow[],
    _retentionDays?: number,
  ): Promise<void> {}
}
