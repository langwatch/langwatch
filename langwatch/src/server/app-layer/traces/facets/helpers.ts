/**
 * Shared SQL helpers for the per-file facet builders in this folder.
 * One source of truth — every facet builder consumes these.
 */

import type { FacetQueryContext } from "../facet-registry";

/**
 * `WHERE` predicate that pins every facet query to the right tenant and
 * time window. The time column varies per table — `OccurredAt` for
 * `trace_summaries`, `StartTime` for `stored_spans`, `ScheduledAt` for
 * `evaluation_runs`. See `TABLE_TIME_COLUMNS` in `facet-registry.ts`.
 *
 * TenantId comes first in the predicate list because of how the
 * cross-tenant index is laid out — the multitenancy review in
 * `dev/docs/best_practices/clickhouse-queries.md` calls this out.
 */
export function buildTimeWhere(timeColumn: string): string {
  return [
    "TenantId = {tenantId:String}",
    `${timeColumn} >= fromUnixTimestamp64Milli({timeFrom:Int64})`,
    `${timeColumn} <= fromUnixTimestamp64Milli({timeTo:Int64})`,
  ].join(" AND ");
}

/**
 * The bound-parameter tuple every facet query relies on. Helpers that need
 * `prefix` add it on top, since not every builder supports key/value
 * prefix-filtering.
 */
export function baseParams(ctx: FacetQueryContext): Record<string, unknown> {
  return {
    tenantId: ctx.tenantId,
    timeFrom: ctx.timeRange.from,
    timeTo: ctx.timeRange.to,
    limit: ctx.limit,
    offset: ctx.offset,
  };
}
