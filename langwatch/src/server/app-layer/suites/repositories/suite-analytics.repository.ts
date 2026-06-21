import type { SuiteAnalyticsRow } from "~/server/event-sourcing/pipelines/suite-run-processing/projections/suiteAnalytics.foldProjection";

/**
 * Repository for the slim `suite_analytics` table (ADR-034 Phase 7).
 */
export interface SuiteAnalyticsRepository {
  upsert(row: SuiteAnalyticsRow, retentionDays?: number): Promise<void>;
  upsertBatch?(
    entries: Array<{ row: SuiteAnalyticsRow; retentionDays?: number }>,
  ): Promise<void>;
}

/** No-op implementation for tests and ClickHouse-less environments. */
export class NullSuiteAnalyticsRepository implements SuiteAnalyticsRepository {
  async upsert(
    _row: SuiteAnalyticsRow,
    _retentionDays?: number,
  ): Promise<void> {}

  async upsertBatch(
    _entries: Array<{ row: SuiteAnalyticsRow; retentionDays?: number }>,
  ): Promise<void> {}
}
