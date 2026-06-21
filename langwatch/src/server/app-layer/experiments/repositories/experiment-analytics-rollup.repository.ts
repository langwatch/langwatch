import type { ExperimentAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/experiment-run-processing/projections/experimentAnalyticsRollup.mapProjection";

/**
 * Per-experiment-run insert into `experiment_analytics_rollup` (ADR-034
 * Phase 7).
 */
export interface ExperimentAnalyticsRollupRepository {
  insertRow(
    row: ExperimentAnalyticsRollupRow,
    retentionDays?: number,
  ): Promise<void>;
  insertRows(
    rows: ExperimentAnalyticsRollupRow[],
    retentionDays?: number,
  ): Promise<void>;
}

/** No-op implementation for tests and ClickHouse-less environments. */
export class NullExperimentAnalyticsRollupRepository
  implements ExperimentAnalyticsRollupRepository
{
  async insertRow(
    _row: ExperimentAnalyticsRollupRow,
    _retentionDays?: number,
  ): Promise<void> {}

  async insertRows(
    _rows: ExperimentAnalyticsRollupRow[],
    _retentionDays?: number,
  ): Promise<void> {}
}
