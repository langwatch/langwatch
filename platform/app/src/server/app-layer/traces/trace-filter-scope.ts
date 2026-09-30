import type { FacetTable } from "./facet-registry";
import type { FilterWhere } from "./hidden-origins";

/**
 * The tenant and window predicate of `trace_summaries`, bound to the same
 * parameter names the filter compiler seeds (`tenantId`, `timeFrom`, `timeTo`).
 */
const TRACE_WINDOW_FROM =
  "TenantId = {tenantId:String} AND OccurredAt >= fromUnixTimestamp64Milli({timeFrom:Int64})";

const TRACE_WINDOW_TO =
  " AND OccurredAt <= fromUnixTimestamp64Milli({timeTo:Int64})";

/**
 * A live window's `to` is rolling, so the reads that bound it leave the upper
 * predicate off and new traces keep arriving (`isLiveUpperBound` in the
 * ClickHouse repository). The membership subquery has to leave it off for the
 * same reason: kept, it caps a filtered `stored_spans` or `evaluation_runs`
 * facet at the instant the request was built, and that facet then counts
 * fewer traces than the table beside it shows.
 */
function traceWindowWhere(isLiveWindow: boolean): string {
  return isLiveWindow ? TRACE_WINDOW_FROM : TRACE_WINDOW_FROM + TRACE_WINDOW_TO;
}

/**
 * A trace filter as a predicate on a facet table.
 *
 * The compiled filter speaks `trace_summaries` columns. On that table it is
 * the filter itself, to be placed after the version dedup like every other
 * read of the table (see `buildWhereClause` in the ClickHouse repository). On
 * `stored_spans` and `evaluation_runs` it becomes a membership test against
 * the traces the filter selects, read at their latest version so a trace
 * whose older row matched the filter is not counted by what it used to say.
 *
 * The parameters are the compiled filter's own: the window predicate reuses
 * the names the compiler already bound.
 */
export function scopeTraceFilterToTable({
  table,
  filterWhere,
  isLiveWindow = false,
}: {
  table: FacetTable;
  filterWhere: FilterWhere;
  /** The window's `to` is rolling, so the reads around this one do not cap it. */
  isLiveWindow?: boolean;
}): FilterWhere {
  if (table === "trace_summaries") {
    return { sql: `(${filterWhere.sql})`, params: filterWhere.params };
  }
  const window = traceWindowWhere(isLiveWindow);
  return {
    sql: `TraceId IN (
      SELECT TraceId
      FROM trace_summaries
      WHERE ${window}
        AND (TenantId, TraceId, UpdatedAt) IN (
          SELECT TenantId, TraceId, max(UpdatedAt)
          FROM trace_summaries
          WHERE ${window}
          GROUP BY TenantId, TraceId
        )
        AND (${filterWhere.sql})
    )`,
    params: filterWhere.params,
  };
}
