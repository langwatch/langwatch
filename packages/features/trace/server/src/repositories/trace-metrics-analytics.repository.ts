// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repositories implement the interface as intentional no-ops.

import type { TraceAnalyticsRow } from "../projections/trace-derived.projection";

/**
 * @see ADR-034 Phase 2
 * Repository for the slim trace_analytics table. Owns the upsert path TraceAnalyticsStore uses on every relevant trace event. Phase 2 is dual-tap only — getTimeseries and the trigger/analytics read path do NOT consume this yet; Phase 3 adds a read interface for percentiles + arbitrary-filter queries the rollup can't serve.
 */
export abstract class TraceAnalyticsRepository {
  /**
   * @see ADR-066, migration 00056
   * Upserts a slim row. Idempotent — ReplacingMergeTree(UpdatedAt), readers dedup to latest per (TenantId, TraceId). retentionDays stamps _retention_days (TTL drops the row that many days after OccurredAt). appliedEventIds is the executor's redelivery-dedup watermark, persisted next to the row (not part of it — fold bookkeeping) so a cold-cache retry still recognises a committed batch.
   */
  abstract upsert(
    row: TraceAnalyticsRow,
    retentionDays?: number,
    appliedEventIds?: readonly string[],
  ): Promise<void>;

  /**
   * Optional batch path; the store falls back to per-row upsert when this is
   * absent. Implementations should validate that all rows share the same
   * tenantId (mirroring TraceAnalyticsRollupClickHouseRepository.insertRows).
   */
  abstract upsertBatch?(
    entries: Array<{
      row: TraceAnalyticsRow;
      retentionDays?: number;
      appliedEventIds?: readonly string[];
    }>,
  ): Promise<void>;

  /**
   * @see ADR-066, migration 00056
   * The trace's last committed slim row plus its applied-event-id watermark. The read-back store uses this on a cache miss so store.get() reconstructs working state (and dedups a redelivered batch) without reading event_log. Null when no row exists. window bounds OccurredAt for partition pruning only — applied verbatim, so a caller unable to rule out a row outside its window retries without one (the fold path gets that retry from the executor's declared-read-window contract).
   */
  abstract tryFindByTraceIdWithApplied(params: {
    tenantId: string;
    traceId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<{ row: TraceAnalyticsRow; appliedEventIds: string[] } | null>;
}

/** No-op implementation for tests and ClickHouse-less environments. */
export class NullTraceAnalyticsRepository implements TraceAnalyticsRepository {
  async upsert(
    _row: TraceAnalyticsRow,
    _retentionDays?: number,
    _appliedEventIds?: readonly string[],
  ): Promise<void> {}

  async upsertBatch(
    _entries: Array<{
      row: TraceAnalyticsRow;
      retentionDays?: number;
      appliedEventIds?: readonly string[];
    }>,
  ): Promise<void> {}

  async tryFindByTraceIdWithApplied(): Promise<{
    row: TraceAnalyticsRow;
    appliedEventIds: string[];
  } | null> {
    return null;
  }
}
