import type { CategoricalRead, RangeRead } from "@langwatch/trace-contract";

export type FacetTable = "trace_summaries" | "evaluation_runs" | "stored_spans";
export type FacetGroup = "trace" | "evaluation" | "span" | "metadata" | "prompt";

export interface FacetQueryContext {
  tenantId: string;
  timeRange: { from: number; to: number; live?: boolean };
  limit: number;
  offset: number;
  prefix?: string;
  /**
   * The active trace filter as a predicate on this facet's own table (see
   * `scopeTraceFilterToTable`), AND-ed into the query's window predicate.
   * Absent for the unfiltered discover read and for value lookups.
   */
  traceScope?: { sql: string; params: Record<string, unknown> };
}

export interface FacetQuery {
  sql: string;
  params: Record<string, unknown>;
  /**
   * Optional per-query ClickHouse settings (e.g. a memory ceiling / external
   * GROUP BY threshold for the unbounded key-discovery facets). Passed straight
   * through as `clickhouse_settings` when the query runs.
   */
  settings?: Record<string, string>;
}

interface BaseFacetDef {
  key: string;
  label: string;
  group: FacetGroup;
  table: FacetTable;
}

export interface ExpressionCategoricalDef extends BaseFacetDef {
  kind: "categorical";
  expression: string;
  /**
   * In-memory accessor mirroring expression for filter compilation.
   */
  read?: CategoricalRead;
}

export interface QueryBuilderCategoricalDef extends BaseFacetDef {
  kind: "categorical";
  queryBuilder: (ctx: FacetQueryContext) => FacetQuery;
}

export interface RangeFacetDef extends BaseFacetDef {
  kind: "range";
  expression: string;
  /**
   * When true, facet presents as discrete tick-list; adds one GROUP BY to discovery.
   */
  isDiscrete?: boolean;
  /** In-memory accessor mirroring `expression`. See {@link ExpressionCategoricalDef.read}. */
  read?: RangeRead;
}

export interface DynamicKeysDef extends BaseFacetDef {
  kind: "dynamic_keys";
  queryBuilder: (ctx: FacetQueryContext) => FacetQuery;
}

export type CategoricalFacetDef = ExpressionCategoricalDef | QueryBuilderCategoricalDef;

export type FacetDefinition = CategoricalFacetDef | RangeFacetDef | DynamicKeysDef;

/** The facets a backend offers, and the time column each of its tables is windowed on. */
export interface FacetCatalog {
  registry: readonly FacetDefinition[];
  timeColumns: Readonly<Record<FacetTable, string>>;
}
