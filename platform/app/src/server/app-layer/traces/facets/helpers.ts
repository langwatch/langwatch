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
 * Per-query memory guard for the unbounded key-discovery facets
 * (`metadata-keys`, `span-attribute-keys`, `event-attribute-keys`). Each
 * flattens an attribute-map's keys with `arrayJoin` and groups by key over the
 * whole time window. A tenant that stuffs high-cardinality data into key names
 * (per-user / UUID keys) turns the GROUP BY into millions of groups, and the
 * read of the keys subcolumn can allocate gigabytes — observed tripping
 * `MEMORY_LIMIT_EXCEEDED` in prod.
 *
 * `max_bytes_before_external_group_by` spills that aggregation to disk so the
 * facet completes instead of OOMing, and `max_memory_usage` caps the read so a
 * pathological tenant fails its own discovery query rather than allocating
 * against the server total — where the OvercommitTracker resolves the pressure
 * by killing whichever query is allocating, degrading unrelated requests. Same
 * rationale as the span repo's `SINGLE_TRACE_READ_SETTINGS`. The ceiling sits
 * above any normal facet read and below the global per-query limit, so it only
 * trips on the pathological tail.
 */
export const KEY_DISCOVERY_SETTINGS: Record<string, string> = {
  // ClickHouse settings are string-typed over the wire.
  max_bytes_before_external_group_by: String(512 * 1024 * 1024), // 512 MiB
  max_memory_usage: String(2 * 1024 * 1024 * 1024), // 2 GiB
};

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
