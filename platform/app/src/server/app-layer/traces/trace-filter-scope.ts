import type { FacetTable } from "./facet-registry";
import type { FilterWhere } from "./hidden-origins";

/**
 * The tenant and window predicate of `trace_summaries`, bound to the same
 * parameter names the filter compiler seeds (`tenantId`, `timeFrom`, `timeTo`).
 */
const TRACE_WINDOW_WHERE =
  "TenantId = {tenantId:String} AND OccurredAt >= fromUnixTimestamp64Milli({timeFrom:Int64}) AND OccurredAt <= fromUnixTimestamp64Milli({timeTo:Int64})";

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
}: {
  table: FacetTable;
  filterWhere: FilterWhere;
}): FilterWhere {
  if (table === "trace_summaries") {
    return { sql: `(${filterWhere.sql})`, params: filterWhere.params };
  }
  return {
    sql: `TraceId IN (
      SELECT TraceId
      FROM trace_summaries
      WHERE ${TRACE_WINDOW_WHERE}
        AND (TenantId, TraceId, UpdatedAt) IN (
          SELECT TenantId, TraceId, max(UpdatedAt)
          FROM trace_summaries
          WHERE ${TRACE_WINDOW_WHERE}
          GROUP BY TenantId, TraceId
        )
        AND (${filterWhere.sql})
    )`,
    params: filterWhere.params,
  };
}
