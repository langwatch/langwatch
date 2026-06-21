import type { ExperimentAnalyticsRow } from "~/server/event-sourcing/pipelines/experiment-run-processing/projections/experimentAnalytics.foldProjection";

/**
 * Repository for the slim `experiment_analytics` table (ADR-034 Phase 7).
 *
 * Owns the upsert path used by `ExperimentAnalyticsStore` on every relevant
 * experiment event. Phase 7 is WRITE-SIDE ONLY — data accumulates silently;
 * no read consumer reads from this table yet.
 */
export interface ExperimentAnalyticsRepository {
  /**
   * Upserts a slim row. Idempotent — the table's
   * `ReplacingMergeTree(UpdatedAt)` dedup collapses re-folds to the latest
   * version per (TenantId, RunId).
   */
  upsert(row: ExperimentAnalyticsRow, retentionDays?: number): Promise<void>;

  upsertBatch?(
    entries: Array<{
      row: ExperimentAnalyticsRow;
      retentionDays?: number;
    }>,
  ): Promise<void>;
}

/** No-op implementation for tests and ClickHouse-less environments. */
export class NullExperimentAnalyticsRepository
  implements ExperimentAnalyticsRepository
{
  async upsert(
    _row: ExperimentAnalyticsRow,
    _retentionDays?: number,
  ): Promise<void> {}

  async upsertBatch(
    _entries: Array<{
      row: ExperimentAnalyticsRow;
      retentionDays?: number;
    }>,
  ): Promise<void> {}
}
