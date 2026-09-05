/**
 * Shared SQL helpers for the per-file facet builders in this folder.
 * One source of truth — every facet builder consumes these.
 */

import type { FacetQueryContext } from "./trace-facet-registry.clickhouse.adapter";

/**
 * Per-query memory guard for unbounded key-discovery facets (metadata/span/event-attribute-keys): each flattens an attribute map with arrayJoin and groups by key over the whole window, and high-cardinality key names (per-user/UUID) turn GROUP BY into millions of groups, tripping MEMORY_LIMIT_EXCEEDED in prod. max_bytes_before_external_group_by spills to disk so the facet completes; max_memory_usage caps the read so a pathological tenant fails its own query rather than triggering the OvercommitTracker to kill an unrelated one (same rationale as SINGLE_TRACE_READ_SETTINGS). Sits above any normal read and below the global limit.
 */
export const KEY_DISCOVERY_SETTINGS: Record<string, string> = {
  // ClickHouse settings are string-typed over the wire.
  max_bytes_before_external_group_by: String(512 * 1024 * 1024), // 512 MiB
  max_memory_usage: String(2 * 1024 * 1024 * 1024), // 2 GiB
};

export class ClickHouseFacetQueryAdapter {
  static create(): ClickHouseFacetQueryAdapter {
    return new ClickHouseFacetQueryAdapter();
  }

  /**
   * See dev/docs/best_practices/clickhouse-queries.md (multitenancy review)
   * WHERE predicate pinning every facet query to the right tenant + time window. Time column varies per table (OccurredAt/StartTime/ScheduledAt — see TABLE_TIME_COLUMNS in facet-registry.ts); TenantId comes first in the predicate list because of how the cross-tenant index is laid out.
   */
  static buildTimeWhere(timeColumn: string): string {
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
  static baseParams(ctx: FacetQueryContext): Record<string, unknown> {
    return {
      tenantId: ctx.tenantId,
      timeFrom: ctx.timeRange.from,
      timeTo: ctx.timeRange.to,
      limit: ctx.limit,
      offset: ctx.offset,
    };
  }
}
