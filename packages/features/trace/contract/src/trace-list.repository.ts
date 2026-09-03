/**
 * Projected fields required by the trace-list read and mapper. This is
 * deliberately separate from the ingest fold state: the list query owns a
 * read-only projection of `trace_summaries` and never exposes Prisma or raw
 * ClickHouse rows.
 */
export interface TraceListSummary {
  traceId: string;
  spanCount: number;
  totalDurationMs: number;
  computedIOSchemaVersion: string;
  computedInput: string | null;
  computedOutput: string | null;
  timeToFirstTokenMs: number | null;
  timeToLastTokenMs: number | null;
  tokensPerSecond: number | null;
  containsErrorStatus: boolean;
  containsOKStatus: boolean;
  errorMessage: string | null;
  models: string[];
  totalCost: number | null;
  nonBilledCost: number | null;
  tokensEstimated: boolean;
  totalPromptTokenCount: number | null;
  totalCompletionTokenCount: number | null;
  outputFromRootSpan: boolean;
  outputSpanEndTimeMs: number;
  blockedByGuardrail: boolean;
  rootSpanType: string | null;
  containsAi: boolean;
  containsPrompt: boolean;
  selectedPromptId: string | null;
  selectedPromptSpanId: string | null;
  selectedPromptStartTimeMs: number | null;
  lastUsedPromptId: string | null;
  lastUsedPromptVersionNumber: number | null;
  lastUsedPromptVersionId: string | null;
  lastUsedPromptSpanId: string | null;
  lastUsedPromptStartTimeMs: number | null;
  topicId: string | null;
  subTopicId: string | null;
  annotationIds: string[];
  sizeBytes?: number;
  attributes: Record<string, string>;
  traceName: string;
  storageAnchorMs?: number;
  occurredAt: number;
  createdAt: number;
  updatedAt: number;
  LastEventOccurredAt: number;
  redactedByVisibilityWindow?: boolean;
}

export interface TraceListFacetQuery {
  sql: string;
  params: Record<string, unknown>;
  settings?: Record<string, string>;
}

export type TraceListSortColumn =
  | "OccurredAt"
  | "TotalDurationMs"
  | "TotalCost"
  | "SpanCount"
  | "TotalTokens"
  | "TimeToFirstTokenMs"
  | "TotalPromptTokenCount"
  | "TotalCompletionTokenCount"
  // MATERIALIZED `_size_bytes` column (see migration 00032). SELECT/ORDER BY
  // only — never inserted.
  | "_size_bytes";

export interface TraceListSort {
  column: TraceListSortColumn;
  direction: "asc" | "desc";
}

/**
 * Keyset cursor for the trace list. The sort value is normalized to a finite
 * number by the repository; TraceId is the unique tie-breaker that turns every
 * supported sort into a total order.
 */
export interface TraceListCursor {
  sortValue: number;
  traceId: string;
}

export interface TraceListQuery {
  tenantId: string;
  timeRange: { from: number; to: number; live?: boolean };
  sort: TraceListSort;
  limit: number;
  /** Cursor takes precedence. Offset remains only for page-one/legacy callers. */
  cursor?: TraceListCursor;
  offset?: number;
  /** Raw WHERE clause fragments + params from filter translator (plugged in later) */
  filterWhere?: { sql: string; params: Record<string, unknown> };
}

/**
 * One page as the REPOSITORY answers it: the stored summary rows and the
 * total. Distinct from `TraceListPage` in `trace-list-view`, which is the
 * page the LIST VIEW publishes — rows mapped to `TraceListItem`, evaluations
 * joined on, and a keyset cursor.
 */
export interface TraceListRepositoryPage {
  rows: TraceListSummary[];
  totalHits: number;
}

export interface FacetCountResult {
  values: Record<string, number>;
}

/**
 * Optional per-value aggregates the evaluator facet attaches alongside
 * its row counts so the sidebar drilldown can render verdict pills and
 * a score range slider inline without firing a second query per
 * evaluator. Other facets leave this absent. The shape is intentionally
 * generic ("aggregates") so future facets that want their own
 * per-value tallies can reuse the same plumbing.
 */
export interface FacetValueAggregates {
  passedCount: number;
  failedCount: number;
  erroredCount: number;
  scoreMin: number | null;
  scoreMax: number | null;
  hasScore: boolean;
  /** Distinct non-null score values — lets the drilldown suppress a score
   *  slider that is degenerate (constant, or binary 0/1 mirroring pass/fail). */
  distinctScores: number;
  hasLabel: boolean;
  /** Top distinct emitted-label values + counts (capped server-side). Drives
   *  the drilldown's clickable label-filter rows. Absent when none emitted. */
  labelValues?: { value: string; count: number }[];
}

export interface CategoricalFacetResult {
  values: {
    value: string;
    label?: string;
    count: number;
    aggregates?: FacetValueAggregates;
  }[];
  totalDistinct: number;
}

export interface DiscreteFacetResult {
  /** Distinct integer values present, ascending, capped by the caller's limit. */
  values: { value: number; count: number }[];
  /** True distinct count (independent of the value cap) — the sidebar uses
   *  this to fall back to the slider above the discrete threshold. */
  distinctCount: number;
}

export type FacetTableName = "trace_summaries" | "evaluation_runs" | "stored_spans";

export interface BatchedFacetResult {
  categoricals: Record<string, CategoricalFacetResult>;
  ranges: Record<string, { min: number; max: number }>;
}

export interface TraceListReadPort {
  findAll(query: TraceListQuery): Promise<TraceListRepositoryPage>;

  findFacetCounts(params: {
    tenantId: string;
    timeRange: { from: number; to: number; live?: boolean };
    facetExpression: string;
    filterWhere?: { sql: string; params: Record<string, unknown> };
  }): Promise<FacetCountResult>;

  findRangeStats(params: {
    tenantId: string;
    timeRange: { from: number; to: number; live?: boolean };
    column: string;
    filterWhere?: { sql: string; params: Record<string, unknown> };
  }): Promise<{ min: number; max: number }>;

  findCount(params: {
    tenantId: string;
    timeRange: { from: number; to: number; live?: boolean };
    since: number;
    filterWhere?: { sql: string; params: Record<string, unknown> };
  }): Promise<number>;

  findDistinctValues(params: {
    tenantId: string;
    column: string;
    prefix: string;
    limit: number;
  }): Promise<string[]>;

  findCategoricalFacet(params: {
    tenantId: string;
    timeRange: { from: number; to: number; live?: boolean };
    table: string;
    timeColumn: string;
    facetExpression: string;
    limit: number;
    offset: number;
    prefix?: string;
  }): Promise<CategoricalFacetResult>;

  findCategoricalFacetRaw(params: {
    tenantId: string;
    query: TraceListFacetQuery;
  }): Promise<CategoricalFacetResult>;

  findRangeStatsForTable(params: {
    tenantId: string;
    timeRange: { from: number; to: number; live?: boolean };
    table: string;
    timeColumn: string;
    column: string;
  }): Promise<{ min: number; max: number }>;

  /**
   * Distinct integer values + counts for a discrete range facet (one declared
   * `isDiscrete: true` on its `RangeFacetDef`), ascending, capped at `limit`.
   * `distinctCount` is exact regardless of the cap so the sidebar can fall back
   * to the slider once the distinct values exceed its threshold.
   */
  findDiscreteValues(params: {
    tenantId: string;
    timeRange: { from: number; to: number; live?: boolean };
    table: FacetTableName;
    timeColumn: string;
    column: string;
    limit: number;
  }): Promise<DiscreteFacetResult>;

  /**
   * Compute multiple categorical and range facets over the same table scan.
   * Categoricals share a single arrayJoin pass; ranges share a single agg pass.
   * Used by `discover` to collapse ~25 parallel queries into ~2 per table.
   */
  findBatchedFacets(params: {
    tenantId: string;
    timeRange: { from: number; to: number; live?: boolean };
    table: FacetTableName;
    timeColumn: string;
    categoricalSpecs: { key: string; expression: string }[];
    rangeSpecs: { key: string; expression: string }[];
    topN: number;
  }): Promise<BatchedFacetResult>;

  /**
   * Distinct values for a single dynamic Attributes key, sampled for speed.
   * Caller must validate `attributeKey` against an injection-safe whitelist —
   * the repo trusts it.
   */
  findAttributeValues(params: {
    tenantId: string;
    timeRange: { from: number; to: number; live?: boolean };
    attributeKey: string;
    prefix?: string;
    limit: number;
    offset: number;
  }): Promise<CategoricalFacetResult>;
}

/** Compatibility name for composition adapters; callers depend on the port. */
export type TraceListRepository = TraceListReadPort;
