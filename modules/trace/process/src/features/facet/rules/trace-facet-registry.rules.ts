import type { CategoricalRead, RangeRead } from "@langwatch/trace-contract";

import type { TraceFilterWhere } from "../../../rules/trace-filter-hidden-origins.rules.ts";

export type FacetTable = "trace_summaries" | "evaluation_runs" | "stored_spans";
type FacetGroup = "trace" | "evaluation" | "span" | "metadata" | "prompt";

export interface FacetQueryContext {
  timeRange: { from: number; to: number; live?: boolean };
  limit: number;
  offset: number;
  prefix?: string;
  /**
   * The active trace filter; the facet store scopes it to its own table and
   * AND-s it into the window predicate. Absent for the unfiltered discover
   * read and for value lookups.
   */
  filterWhere?: TraceFilterWhere;
  /** The window's `to` is rolling, so the scoped filter leaves it uncapped. */
  isLiveWindow?: boolean;
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

type CategoricalFacetDef = ExpressionCategoricalDef | QueryBuilderCategoricalDef;

export type FacetDefinition = CategoricalFacetDef | RangeFacetDef | DynamicKeysDef;

/** The facets a backend offers, and the time column each of its tables is windowed on. */
export interface FacetCatalog {
  registry: readonly FacetDefinition[];
  timeColumns: Readonly<Record<FacetTable, string>>;
}
