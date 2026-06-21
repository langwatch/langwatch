import type { SimulationAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/simulation-processing/projections/simulationAnalyticsRollup.mapProjection";

/**
 * Per-simulation-run insert into `simulation_analytics_rollup` (ADR-034
 * Phase 7 — scenarios mirror of `TraceAnalyticsRollupRepository` /
 * `EvaluationAnalyticsRollupRepository`).
 *
 * The rollup is an `AggregatingMergeTree` with
 * `SimpleAggregateFunction(sum, ...)` columns, so the repository writes plain
 * scalar values (a UInt64, an Int64) — no `sumState` binary states. Each call
 * appends a single row representing one simulation's contribution; merges
 * roll the rows up into one row per (TenantId, BucketStart, Verdict, Status).
 *
 * `retentionDays` (when provided) is stamped onto the row's `_retention_days`
 * column; the table's TTL drops the row that many days after its
 * `BucketStart`.
 */
export interface SimulationAnalyticsRollupRepository {
  insertRow(
    row: SimulationAnalyticsRollupRow,
    retentionDays?: number,
  ): Promise<void>;
  insertRows(
    rows: SimulationAnalyticsRollupRow[],
    retentionDays?: number,
  ): Promise<void>;
}

/** No-op implementation for tests and ClickHouse-less environments. */
export class NullSimulationAnalyticsRollupRepository
  implements SimulationAnalyticsRollupRepository
{
  async insertRow(
    _row: SimulationAnalyticsRollupRow,
    _retentionDays?: number,
  ): Promise<void> {}

  async insertRows(
    _rows: SimulationAnalyticsRollupRow[],
    _retentionDays?: number,
  ): Promise<void> {}
}
