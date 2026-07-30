// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repositories implement the interface as intentional no-ops.

/**
 * One `trace_analytics` row, field-per-column so the ClickHouse repository's
 * record literal stays a 1:1 mapping. `updatedAtMs` is the LWW dedup key;
 * `version` is only the schema snapshot the row was written under.
 */
export interface TraceAnalyticsRow {
  tenantId: string;
  traceId: string;
  version: string;
  /**
   * The trace's STORAGE ANCHOR → the `OccurredAt` column: partition key, lead
   * sort key and TTL anchor at once. The first business time observed for the
   * trace, frozen; the running minimum of span starts is `earliestSpanStartMs`.
   */
  occurredAtMs: number;
  /**
   * Earliest start across the trace's non-synthetic spans, 0 while none has
   * been folded. `totalDurationMs` is measured from it. Its own column because
   * `OccurredAt` no longer carries it, and without one a read-back would decode
   * "no span yet" onto a trace that has spans.
   */
  earliestSpanStartMs: number;
  createdAtMs: number;
  updatedAtMs: number;

  // Hoisted dimensions (typed root-level columns).
  traceName: string;
  topicId: string | null;
  subTopicId: string | null;
  userId: string | null;
  conversationId: string | null;
  customerId: string | null;
  origin: string;
  models: string[];
  labels: string[];

  // Metric scalars.
  totalCost: number | null;
  nonBilledCost: number | null;
  totalDurationMs: number;
  timeToFirstTokenMs: number | null;
  tokensPerSecond: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  hasError: boolean;
  hasAnnotation: boolean | null;

  /** Post-`trimAttributesForAnalytics`. */
  attributes: Record<string, string>;

  // Read-back state: not analytics columns, but what lets a fold decode the row
  // without replaying `event_log`. The hoisted dimensions above double as
  // read-back sources for the attribute map; these carry what the slim row
  // otherwise dropped.
  /** Spans seen — the processed-span cap AND the persistable-signal gate. */
  spanCount: number;
  /** The id set behind `hasAnnotation`; the row keeps only the boolean. */
  annotationIds: string[];
  /** Canonical root span start (0 = none yet); the trace-name precedence gate. */
  rootSpanStartTimeMs: number;
  traceNameFromFallback: boolean;
  rootMetadataFromFallback: boolean;
  /** A user rename latched the name against later span-derived clobbering. */
  traceNameUserOverridden: boolean;
  /** The fold's out-of-order checkpoint, distinct from `occurredAtMs`. */
  lastEventOccurredAt: number;
}

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
