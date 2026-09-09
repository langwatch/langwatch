import type { TraceAnalyticsRow } from "../projections/trace-derived.projection.ts";

/**
 * @see ADR-034 Phase 2
 * Repository for the slim trace_analytics table, owning the upsert path
 * TraceAnalyticsStore uses on every relevant trace event. Phase 2 is
 * dual-tap only — getTimeseries and the analytics read path don't consume
 * this yet; Phase 3 adds a read interface for percentiles + arbitrary filters.
 */
export abstract class TraceAnalyticsRepository {
  /**
   * @see ADR-066, migration 00056
   * Upserts a slim row. Idempotent (ReplacingMergeTree(UpdatedAt), dedups
   * to latest per TenantId/TraceId). retentionDays stamps _retention_days
   * (TTL). appliedEventIds is the executor's redelivery-dedup watermark,
   * persisted beside the row so a cold-cache retry recognises a committed batch.
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
   * The trace's last committed slim row plus its applied-event-id watermark.
   * The read-back store uses this on a cache miss to reconstruct working
   * state without reading event_log. Null when no row exists. `window`
   * bounds OccurredAt for partition pruning only, applied verbatim.
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
