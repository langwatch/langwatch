import type { TraceAnalyticsRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceAnalytics.foldProjection";

/**
 * Repository for the slim trace_analytics table (ADR-034 Phase 2). Owns the
 * upsert path used by `TraceAnalyticsStore` on every relevant trace event.
 *
 * Phase 2 is dual-tap only — `getTimeseries` and the trigger/analytics read
 * path do NOT consume this repository yet. Phase 3 will add a read interface
 * for percentiles + arbitrary-filter queries that the rollup can't serve.
 */
export interface TraceAnalyticsRepository {
  /**
   * Upserts a slim row. Idempotent — the table's ReplacingMergeTree(Version)
   * dedup collapses re-folds to the latest version per (TenantId, TraceId).
   * `retentionDays` is stamped onto the row's `_retention_days` column; the
   * table's TTL drops the row that many days after its `OccurredAt`.
   */
  upsert(row: TraceAnalyticsRow, retentionDays?: number): Promise<void>;

  /**
   * Optional batch path; the store falls back to per-row upsert when this is
   * absent. Implementations should validate that all rows share the same
   * tenantId (mirroring TraceAnalyticsRollupClickHouseRepository.insertRows).
   */
  upsertBatch?(
    entries: Array<{ row: TraceAnalyticsRow; retentionDays?: number }>,
  ): Promise<void>;
}

/** No-op implementation for tests and ClickHouse-less environments. */
export class NullTraceAnalyticsRepository implements TraceAnalyticsRepository {
  async upsert(
    _row: TraceAnalyticsRow,
    _retentionDays?: number,
  ): Promise<void> {}

  async upsertBatch(
    _entries: Array<{ row: TraceAnalyticsRow; retentionDays?: number }>,
  ): Promise<void> {}
}
