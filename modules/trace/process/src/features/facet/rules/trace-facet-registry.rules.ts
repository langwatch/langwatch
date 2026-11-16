import type { ClickHouseReadStatement } from "@langwatch/clickhouse-client/builder";
import type { CategoricalRead, RangeRead } from "@langwatch/trace-contract";

import type { FacetRowsScan } from "../repositories/clickhouse/clickhouse.trace-facet-scope.mapper.ts";

export type FacetTable = "trace_summaries" | "evaluation_runs" | "stored_spans";
type FacetGroup = "trace" | "evaluation" | "span" | "metadata" | "prompt";

/** A queryBuilder facet's read: its proof, window and filter, its page and value prefix. */
export type FacetQueryContext = FacetRowsScan & {
  limit: number;
  offset: number;
  prefix?: string;
};

/** A queryBuilder facet's built read; its rows are the facet row the repository maps. */
export type FacetQuery = ClickHouseReadStatement<Record<string, unknown>>;

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
