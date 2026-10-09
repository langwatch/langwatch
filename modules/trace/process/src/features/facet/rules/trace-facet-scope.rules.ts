/**
 * A trace filter read as a predicate on a facet's own table. ADR-139.
 */

import { tenantScope } from "@langwatch/authorization/tenant-fence";
import type { FacetTableName } from "@langwatch/trace-contract";

import type { TraceFilterWhere } from "../../../rules/trace-filter-hidden-origins.rules.ts";

/**
 * The tenant marker and window predicate of `trace_summaries`. The window is bound to the
 * parameter names the filter compiler seeds (`timeFrom`, `timeTo`); the tenant is the authorized
 * reader's to add (ADR-175).
 */
const TRACE_WINDOW_FROM = `${tenantScope("OccurredAt")} AND OccurredAt >= fromUnixTimestamp64Milli({timeFrom:Int64})`;

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
 * On `trace_summaries` the filter itself, after the version dedup. Elsewhere a membership test on
 * the (tenant, trace id) pair against the traces it selects at their latest version, since a
 * fence can span tenants sharing a trace id.
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
    sql: `((TenantId, TraceId) IN (
      SELECT TenantId, TraceId
      FROM trace_summaries
      WHERE ${window}
        AND (TenantId, TraceId, UpdatedAt) IN (
          SELECT TenantId, TraceId, max(UpdatedAt)
          FROM trace_summaries
          WHERE ${window}
          GROUP BY TenantId, TraceId
        )
        AND (${filterWhere.sql})
    ))`,
    params: filterWhere.params,
  };
}
