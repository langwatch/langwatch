import type { EvaluationAnalyticsRow } from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationAnalytics.foldProjection";

/**
 * Repository for the slim `evaluation_analytics` table (ADR-034 Phase 6 —
 * eval mirror of `TraceAnalyticsRepository`).
 *
 * Owns the upsert path used by `EvaluationAnalyticsStore` on every
 * relevant evaluation event. Phase 6 is dual-tap only — the analytics
 * `getTimeseries` read path routes here when `pickAnalyticsTable` selects
 * `"evaluation_analytics"` for an eval-source metric.
 */
export interface EvaluationAnalyticsRepository {
  /**
   * Upserts a slim row. Idempotent — the table's
   * `ReplacingMergeTree(UpdatedAt)` dedup collapses re-folds to the latest
   * version per (TenantId, EvaluationId). `retentionDays` is stamped onto
   * the row's `_retention_days` column; the table's TTL drops the row that
   * many days after its `OccurredAt`.
   */
  upsert(row: EvaluationAnalyticsRow, retentionDays?: number): Promise<void>;

  /**
   * Optional batch path; the store falls back to per-row upsert when this
   * is absent. Implementations should validate that all rows share the
   * same tenantId.
   */
  upsertBatch?(
    entries: Array<{
      row: EvaluationAnalyticsRow;
      retentionDays?: number;
    }>,
  ): Promise<void>;
}

/** No-op implementation for tests and ClickHouse-less environments. */
export class NullEvaluationAnalyticsRepository
  implements EvaluationAnalyticsRepository
{
  async upsert(
    _row: EvaluationAnalyticsRow,
    _retentionDays?: number,
  ): Promise<void> {}

  async upsertBatch(
    _entries: Array<{
      row: EvaluationAnalyticsRow;
      retentionDays?: number;
    }>,
  ): Promise<void> {}
}
