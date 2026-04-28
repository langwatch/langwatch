import type { TraceSummaryData } from "../types";

export interface TraceListSort {
  column: "OccurredAt" | "TotalDurationMs" | "TotalCost";
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

export interface CategoricalFacetResult {
  values: { value: string; label?: string; count: number }[];
  totalDistinct: number;
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
  async findAttributeValues(): Promise<CategoricalFacetResult> {
    return { values: [], totalDistinct: 0 };
  }
}
