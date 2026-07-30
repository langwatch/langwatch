/** One span's contribution to a `trace_analytics_rollup` minute bucket. */
export interface TraceAnalyticsRollupRow {
  tenantId: string;
  /** Minute bucket of the span's `startTimeUnixMs` (`toStartOfMinute`). */
  bucketStart: Date;
  /**
   * Response model > request model > ''. A SORT key, not a group-by target: the
   * rollup attributes each span's cost to that span's own model, whereas the
   * slim table attributes a trace's whole cost to every model it used.
   */
  model: string;
  /** `langwatch.span.type` ('' when absent). */
  spanType: string;
  /** Always 1 (one row per span). */
  spanCount: number;
  /** 1 on the root span, 0 on the rest, so `sum(TraceCount)` is the bucket's traces. */
  traceCount: number;
  errorCount: number;
  costSum: number;
  /** Bundled-portion cost (USD). */
  nonBilledCostSum: number;
  /** The root carries the trace's wall-clock duration; others carry 0. */
  durationSum: number;
  promptTokensSum: number;
  completionTokensSum: number;
  cacheReadTokensSum: number;
  cacheWriteTokensSum: number;
  reasoningTokensSum: number;
}

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
  insertRow(
    row: TraceAnalyticsRollupRow,
    retentionDays?: number,
  ): Promise<void>;
  insertRows(
    rows: TraceAnalyticsRollupRow[],
    retentionDays?: number,
  ): Promise<void>;
}
