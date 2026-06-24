import type { EvaluationAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationAnalyticsRollup.mapProjection";

/**
 * Per-evaluation insert into `evaluation_analytics_rollup` (ADR-034
 * Phase 6 — eval mirror of `TraceAnalyticsRollupRepository`).
 *
 * The rollup is an `AggregatingMergeTree` with
 * `SimpleAggregateFunction(sum, ...)` columns, so the repository writes
 * plain scalar values (a UInt64, a Float64) — no `sumState` binary states.
 * Each call appends a single row representing one evaluation's
 * contribution; merges roll the rows up into one row per
 * (TenantId, BucketStart, EvaluatorType, Status).
 *
 * `retentionDays` (when provided) is stamped onto the row's
 * `_retention_days` column; the table's TTL drops the row that many days
 * after its `BucketStart`.
 */
export interface EvaluationAnalyticsRollupRepository {
  insertRow(
    row: EvaluationAnalyticsRollupRow,
    retentionDays?: number,
  ): Promise<void>;
  insertRows(
    rows: EvaluationAnalyticsRollupRow[],
    retentionDays?: number,
  ): Promise<void>;
}

/** No-op implementation for tests and ClickHouse-less environments. */
export class NullEvaluationAnalyticsRollupRepository
  implements EvaluationAnalyticsRollupRepository
{
  async insertRow(
    _row: EvaluationAnalyticsRollupRow,
    _retentionDays?: number,
  ): Promise<void> {}

  async insertRows(
    _rows: EvaluationAnalyticsRollupRow[],
    _retentionDays?: number,
  ): Promise<void> {}
}
