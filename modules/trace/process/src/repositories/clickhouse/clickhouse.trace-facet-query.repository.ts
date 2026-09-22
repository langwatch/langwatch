/**
 * Shared SQL helpers for the per-file facet builders in this folder.
 * One source of truth — every facet builder consumes these.
 */

import type { FacetQueryContext } from "./clickhouse.trace-facet-registry.repository.ts";

/**
 * Per-query memory settings for high-cardinality key-discovery facets.
 */
export const KEY_DISCOVERY_SETTINGS: Record<string, string> = {
  // ClickHouse settings are string-typed over the wire.
  max_bytes_before_external_group_by: String(512 * 1024 * 1024), // 512 MiB
  max_memory_usage: String(2 * 1024 * 1024 * 1024), // 2 GiB
};

export class ClickHouseTraceFacetQueryRepository {
  private constructor() {}

  static create(): ClickHouseTraceFacetQueryRepository {
    return new ClickHouseTraceFacetQueryRepository();
  }

  /**
   * WHERE predicate with tenant filtering and time window, per clickhouse-queries.md.
   */
  buildTimeWhere(timeColumn: string, ctx?: Pick<FacetQueryContext, "traceScope">): string {
    return [
      "TenantId = {tenantId:String}",
      `${timeColumn} >= fromUnixTimestamp64Milli({timeFrom:Int64})`,
      `${timeColumn} <= fromUnixTimestamp64Milli({timeTo:Int64})`,
      ...(ctx?.traceScope ? [ctx.traceScope.sql] : []),
    ].join(" AND ");
  }

  /**
   * The bound-parameter tuple every facet query relies on. Helpers that need
   * `prefix` add it on top, since not every builder supports key/value
   * prefix-filtering.
   */
  baseParams(ctx: FacetQueryContext): Record<string, unknown> {
    return {
      ...ctx.traceScope?.params,
      tenantId: ctx.tenantId,
      timeFrom: ctx.timeRange.from,
      timeTo: ctx.timeRange.to,
      limit: ctx.limit,
      offset: ctx.offset,
    };
  }
}
