// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repositories implement the interface as intentional no-ops.

import type { TraceAnalyticsRow } from "~/server/event-sourcing.old/pipelines/trace-processing/projections/traceAnalytics.foldProjection";

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
   * Upserts a slim row. Idempotent — the table is ReplacingMergeTree(UpdatedAt)
   * and readers dedup to the latest UpdatedAt per (TenantId, TraceId).
   * `retentionDays` is stamped onto the row's `_retention_days` column; the
   * table's TTL drops the row that many days after its `OccurredAt`.
   *
   * `appliedEventIds` is the executor's redelivery-dedup watermark (ADR-066,
   * migration 00056): the ids folded into this write, persisted next to the row
   * so a retry with a cold cache still recognises a batch it already committed.
   * Not part of the row — it is fold bookkeeping, not trace analytics.
   */
  upsert(
    row: TraceAnalyticsRow,
    retentionDays?: number,
    appliedEventIds?: readonly string[],
  ): Promise<void>;

  /**
   * Optional batch path; the store falls back to per-row upsert when this is
   * absent. Implementations should validate that all rows share the same
   * tenantId (mirroring TraceAnalyticsRollupClickHouseRepository.insertRows).
   */
  upsertBatch?(
    entries: Array<{
      row: TraceAnalyticsRow;
      retentionDays?: number;
      appliedEventIds?: readonly string[];
    }>,
  ): Promise<void>;

  /**
   * The trace's last committed slim row plus the applied-event-id watermark
   * persisted next to it (ADR-066, migration 00056). The read-back store uses
   * this on a cache miss so `store.get()` reconstructs working state — and a
   * retry can dedup a redelivered batch — without ever reading `event_log`.
   * Null when no row exists.
   *
   * `window` bounds OccurredAt so ClickHouse prunes partitions; the repository
   * applies it verbatim (a pruning optimisation only), so a caller that cannot
   * rule out a row outside its window retries without one — the fold path gets
   * that retry from the executor's declared-read-window contract.
   */
  findByTraceIdWithApplied(params: {
    tenantId: string;
    traceId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<{ row: TraceAnalyticsRow; appliedEventIds: string[] } | null>;
}
