import type { TraceSummaryData } from "../types";

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

export interface TraceListQuery {
  tenantId: string;
  timeRange: { from: number; to: number; live?: boolean };
  sort: TraceListSort;
  limit: number;
  offset: number;
  /** Raw WHERE clause fragments + params from filter translator (plugged in later) */
  filterWhere?: { sql: string; params: Record<string, unknown> };
}

export interface TraceListPage {
  rows: TraceSummaryData[];
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

export type FacetTableName =
  | "trace_summaries"
  | "evaluation_runs"
  | "stored_spans";

export interface BatchedFacetResult {
  categoricals: Record<string, CategoricalFacetResult>;
  ranges: Record<string, { min: number; max: number }>;
}

export interface TraceListRepository {
  findAll(query: TraceListQuery): Promise<TraceListPage>;

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
    query: { sql: string; params: Record<string, unknown> };
  }): Promise<CategoricalFacetResult>;

  findRangeStatsForTable(params: {
    tenantId: string;
    timeRange: { from: number; to: number; live?: boolean };
    table: string;
    timeColumn: string;
    column: string;
  }): Promise<{ min: number; max: number }>;

  /**
   * Distinct integer values + counts for an integer range facet (one declared
   * `integer: true` on its `RangeFacetDef`), ascending, capped at `limit`.
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

export class NullTraceListRepository implements TraceListRepository {
  async findAll(): Promise<TraceListPage> {
    return { rows: [], totalHits: 0 };
  }
  async findFacetCounts(): Promise<FacetCountResult> {
    return { values: {} };
  }
  async findRangeStats(): Promise<{ min: number; max: number }> {
    return { min: 0, max: 0 };
  }
  async findCount(): Promise<number> {
    return 0;
  }
  async findDistinctValues(): Promise<string[]> {
    return [];
  }
  async findCategoricalFacet(): Promise<CategoricalFacetResult> {
    return { values: [], totalDistinct: 0 };
  }
  async findCategoricalFacetRaw(): Promise<CategoricalFacetResult> {
    return { values: [], totalDistinct: 0 };
  }
  async findRangeStatsForTable(): Promise<{ min: number; max: number }> {
    return { min: 0, max: 0 };
  }
  async findDiscreteValues(): Promise<DiscreteFacetResult> {
    return { values: [], distinctCount: 0 };
  }
  async findBatchedFacets(): Promise<BatchedFacetResult> {
    return { categoricals: {}, ranges: {} };
  }
  async findAttributeValues(): Promise<CategoricalFacetResult> {
    return { values: [], totalDistinct: 0 };
  }
}
