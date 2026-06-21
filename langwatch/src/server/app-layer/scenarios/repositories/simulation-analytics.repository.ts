import type { SimulationAnalyticsRow } from "~/server/event-sourcing/pipelines/simulation-processing/projections/simulationAnalytics.foldProjection";

/**
 * Repository for the slim `simulation_analytics` table (ADR-034 Phase 7 —
 * scenarios mirror of `TraceAnalyticsRepository` / `EvaluationAnalyticsRepository`).
 *
 * Owns the upsert path used by `SimulationAnalyticsStore` on every relevant
 * simulation event. Phase 7 is WRITE-SIDE ONLY — data accumulates silently;
 * no read consumer reads from this table yet.
 */
export interface SimulationAnalyticsRepository {
  /**
   * Upserts a slim row. Idempotent — the table's
   * `ReplacingMergeTree(UpdatedAt)` dedup collapses re-folds to the latest
   * version per (TenantId, ScenarioRunId). `retentionDays` is stamped onto
   * the row's `_retention_days` column; the table's TTL drops the row that
   * many days after its `OccurredAt`.
   */
  upsert(row: SimulationAnalyticsRow, retentionDays?: number): Promise<void>;

  /**
   * Optional batch path; the store falls back to per-row upsert when this
   * is absent. Implementations should validate that all rows share the same
   * tenantId.
   */
  upsertBatch?(
    entries: Array<{
      row: SimulationAnalyticsRow;
      retentionDays?: number;
    }>,
  ): Promise<void>;
}

/** No-op implementation for tests and ClickHouse-less environments. */
export class NullSimulationAnalyticsRepository
  implements SimulationAnalyticsRepository
{
  async upsert(
    _row: SimulationAnalyticsRow,
    _retentionDays?: number,
  ): Promise<void> {}

  async upsertBatch(
    _entries: Array<{
      row: SimulationAnalyticsRow;
      retentionDays?: number;
    }>,
  ): Promise<void> {}
}
