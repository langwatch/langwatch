import type { ProjectionPlan } from "./trace-projection.types.ts";

/**
 * Analytics filter selection shape (server can't import analytics browser
 * package for schema). Validated at transport via `TracesTrpcMembers.filterInputSchema`.
 */
export type TraceSharedFiltersInput = {
  projectId: string;
  startDate: number;
  endDate: number;
  query?: string;
  filters: Record<
    string,
    string[] | Record<string, string[]> | Record<string, Record<string, string[]>> | undefined
  >;
  traceIds?: string[];
  negateFilters?: boolean;
};

/**
 * Inputs to the legacy trace read. Results live in `trace-contract` (alongside
 * trace formats); inputs stay here since they derive from analytics schema and projection.
 */

/** Time axis that `startDate`/`endDate` and the keyset cursor apply to. */
export type TraceDateField = "occurred" | "updated";

/**
 * Options for getAllTracesForProject, shared by the TraceService facade and the
 * ClickHouse implementation so the contract stays in one place.
 */
export interface GetAllTracesForProjectOptions {
  downloadMode?: boolean;
  includeSpans?: boolean;
  /**
   * Resolve offloaded >64 KB IO from event_log to the FULL value (#4991).
   * Only the download/export path opts in (ADR-022); requires
   * `includeSpans: true` and TraceService blob-resolution deps.
   */
  resolveBlobs?: boolean;
  scrollId?: string | null;
  /**
   * Which time axis the date window + keyset cursor filter on. "occurred"
   * (default) keeps the legacy OccurredAt behavior; "updated" pages by last
   * mutation time for incremental ETL (CDC) pulls.
   */
  dateField?: TraceDateField;
  /**
   * Compiled projection plan (from the projection DSL). Drives which child
   * collections are JOINed and whether the heavy io columns are fetched.
   * Opaque to callers — produced by `compileProjection`.
   */
  projection?: ProjectionPlan;
  /**
   * A pre-compiled ClickHouse WHERE fragment, ANDed into the read — the v1
   * REST search door's query-language `filter`, already compiled by
   * `TraceApi.compileExplorerTraceFilter` before it reaches here.
   */
  filterWhere?: { sql: string; params: Record<string, unknown> };
}

/**
 * Input parameters for getAllTracesForProject.
 * Used by the ClickHouse trace service.
 * Extends the shared filters input schema with pagination and sorting options.
 */
export type GetAllTracesForProjectInput = TraceSharedFiltersInput & {
  // No pageOffset: offset paging was dropped in the ClickHouse migration and
  // the boundary now rejects a non-zero one (#6808). Paging is scrollId only.
  pageSize?: number;
  groupBy?: string;
  sortBy?: string;
  sortDirection?: string;
  scrollId?: string | null;
  updatedAt?: number;
};

/**
 * Input parameters for aggregation queries (getTopicCounts, getCustomersAndLabels).
 */
export type AggregationFiltersInput = TraceSharedFiltersInput;
