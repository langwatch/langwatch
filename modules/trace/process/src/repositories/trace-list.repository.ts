import type { Authorization } from "@langwatch/authorization";
import type {
  BatchedFacetResult,
  CategoricalFacetResult,
  DiscreteFacetResult,
  FacetTableName,
  TraceListCursor,
  TraceListFacetQuery,
  TraceListRepositoryPage,
  TraceListSort,
  TraceRef,
} from "@langwatch/trace-contract";

import type { TraceFilterCompile } from "../features/query/repositories/clickhouse/clickhouse.trace-filter-condition.mapper.ts";
import type { TraceFilterWhere } from "../rules/trace-filter-hidden-origins.rules.ts";

export interface TraceListQuery {
  /** The proof the read is fenced by; the reader applies its tenant set. */
  authorization: Authorization;
  timeRange: { from: number; to: number; live?: boolean };
  sort: TraceListSort;
  limit: number;
  /** Cursor takes precedence. Offset remains only for page-one/legacy callers. */
  cursor?: TraceListCursor;
  offset?: number;
  /** The trace filter, compiled for the read's own scope (ADR-202 Decided 25). */
  compileFilter?: TraceFilterCompile;
}

export interface TraceListRepository {
  listAll(query: TraceListQuery): Promise<TraceListRepositoryPage>;

  findCount(params: {
    authorization: Authorization;
    timeRange: { from: number; to: number; live?: boolean };
    since: number;
    compileFilter?: TraceFilterCompile;
  }): Promise<number>;

  /**
   * The traces matching the filter, newest first and capped, each named by tenant and trace id:
   * two aggregate members may hold the same id (ADR-177). Deduped the IN-tuple way.
   */
  findTraceRefs(params: {
    authorization: Authorization;
    timeRange: { from: number; to: number; live?: boolean };
    compileFilter?: TraceFilterCompile;
    limit: number;
  }): Promise<TraceRef[]>;

  findDistinctValues(params: {
    authorization: Authorization;
    column: string;
    prefix: string;
    limit: number;
  }): Promise<string[]>;

  /**
   * `filterWhere` on the facet reads below is the active trace filter, which
   * every read scopes to its own table and applies after the version dedup.
   * Absent for the unfiltered discover read.
   */
  findCategoricalFacet(params: {
    authorization: Authorization;
    timeRange: { from: number; to: number; live?: boolean };
    table: FacetTableName;
    timeColumn: string;
    facetExpression: string;
    limit: number;
    offset: number;
    prefix?: string;
    filterWhere?: TraceFilterWhere;
  }): Promise<CategoricalFacetResult>;

  findCategoricalFacetRaw(params: {
    authorization: Authorization;
    query: TraceListFacetQuery;
  }): Promise<CategoricalFacetResult>;

  findRangeStatsForTable(params: {
    authorization: Authorization;
    timeRange: { from: number; to: number; live?: boolean };
    table: FacetTableName;
    timeColumn: string;
    column: string;
    filterWhere?: TraceFilterWhere;
  }): Promise<{ min: number; max: number }>;

  /**
   * Distinct integer values + counts for a discrete range facet (one declared `isDiscrete:
   * true` on its `RangeFacetDef`), ascending, capped at `limit`.
   */
  findDiscreteValues(params: {
    authorization: Authorization;
    timeRange: { from: number; to: number; live?: boolean };
    table: FacetTableName;
    timeColumn: string;
    column: string;
    limit: number;
    filterWhere?: TraceFilterWhere;
  }): Promise<DiscreteFacetResult>;

  /**
   * Compute multiple categorical and range facets over the same table scan.
   * Categoricals share a single arrayJoin pass; ranges share a single agg pass.
   * Used by `discover` to collapse ~25 parallel queries into ~2 per table.
   */
  findBatchedFacets(params: {
    authorization: Authorization;
    timeRange: { from: number; to: number; live?: boolean };
    table: FacetTableName;
    timeColumn: string;
    categoricalSpecs: { key: string; expression: string }[];
    rangeSpecs: { key: string; expression: string }[];
    topN: number;
    filterWhere?: TraceFilterWhere;
  }): Promise<BatchedFacetResult>;

  /**
   * Distinct values for a single dynamic Attributes key, sampled for speed.
   * Caller must validate `attributeKey` against an injection-safe whitelist —
   * the repo trusts it.
   */
  findAttributeValues(params: {
    authorization: Authorization;
    timeRange: { from: number; to: number; live?: boolean };
    attributeKey: string;
    prefix?: string;
    limit: number;
    offset: number;
  }): Promise<CategoricalFacetResult>;

  /**
   * Distinct values for a single event-attribute key, read from
   * `stored_spans.Events.Attributes` — the store the `event.attribute.` filter actually
   * queries.
   */
  findEventAttributeValues(params: {
    authorization: Authorization;
    timeRange: { from: number; to: number; live?: boolean };
    attributeKey: string;
    prefix?: string;
    limit: number;
    offset: number;
  }): Promise<CategoricalFacetResult>;

  /**
   * Distinct values for a single span-attribute key, read from
   * `stored_spans.SpanAttributes`. Same sampling strategy and
   * injection-safety contract as {@link findAttributeValues}.
   */
  findSpanAttributeValues(params: {
    authorization: Authorization;
    timeRange: { from: number; to: number; live?: boolean };
    attributeKey: string;
    prefix?: string;
    limit: number;
    offset: number;
  }): Promise<CategoricalFacetResult>;
}

/** The list reads as the services name them. */
export type TraceListRead = TraceListRepository;
