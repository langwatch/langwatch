/**
 * A trace filter read as a predicate on a facet's own table. ADR-139.
 */

import type { FacetTableName } from "@langwatch/trace-contract";

import type { TraceFilterWhere } from "./trace-filter-hidden-origins.rules.ts";

/**
 * The tenant and window predicate of `trace_summaries`, bound to the same
 * parameter names the filter compiler seeds (`tenantId`, `timeFrom`, `timeTo`).
 */
const TRACE_WINDOW_FROM =
  "TenantId = {tenantId:String} AND OccurredAt >= fromUnixTimestamp64Milli({timeFrom:Int64})";

const TRACE_WINDOW_TO = " AND OccurredAt <= fromUnixTimestamp64Milli({timeTo:Int64})";

/**
 * A live window's `to` is rolling, so the reads that bound it leave the upper
 * predicate off; kept here it would cap a filtered facet at the instant the
 * request was built.
 */
function traceWindowWhere(isLiveWindow: boolean): string {
  return isLiveWindow ? TRACE_WINDOW_FROM : TRACE_WINDOW_FROM + TRACE_WINDOW_TO;
}

/**
 * On `trace_summaries` the filter itself, placed after the version dedup. On
 * the other facet tables a membership test against the traces it selects, read
 * at their latest version so an older row's values do not count.
 */
export function scopeTraceFilterToTable({
  table,
  filterWhere,
  isLiveWindow = false,
}: {
  table: FacetTableName;
  filterWhere: TraceFilterWhere;
  /** The window's `to` is rolling, so the reads around this one do not cap it. */
  isLiveWindow?: boolean;
}): TraceFilterWhere {
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
