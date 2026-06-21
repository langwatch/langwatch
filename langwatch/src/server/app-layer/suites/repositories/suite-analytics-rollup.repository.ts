import type { SuiteAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/suite-run-processing/projections/suiteAnalyticsRollup.mapProjection";

/**
 * Per-item insert into `suite_analytics_rollup` (ADR-034 Phase 7).
 */
export interface SuiteAnalyticsRollupRepository {
  insertRow(
    row: SuiteAnalyticsRollupRow,
    retentionDays?: number,
  ): Promise<void>;
  insertRows(
    rows: SuiteAnalyticsRollupRow[],
    retentionDays?: number,
  ): Promise<void>;
}

/** No-op implementation for tests and ClickHouse-less environments. */
export class NullSuiteAnalyticsRollupRepository
  implements SuiteAnalyticsRollupRepository
{
  async insertRow(
    _row: SuiteAnalyticsRollupRow,
    _retentionDays?: number,
  ): Promise<void> {}

  async insertRows(
    _rows: SuiteAnalyticsRollupRow[],
    _retentionDays?: number,
  ): Promise<void> {}
}
