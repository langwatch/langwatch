/**
 * Shared SQL helpers for the per-file facet builders in this folder.
 * One source of truth — every facet builder consumes these.
 */

import { type TenantScopeTimeColumn, tenantScope } from "@langwatch/clickhouse-client";

import type { FacetQueryContext } from "../../rules/trace-facet-registry.rules.ts";
import { scopeTraceFilterToTable } from "./clickhouse.trace-facet-scope.mapper.ts";

/** The facet table each builder's time column windows. */
const FACET_TABLE_BY_TIME_COLUMN = {
  OccurredAt: "trace_summaries",
  StartTime: "stored_spans",
  ScheduledAt: "evaluation_runs",
} as const satisfies Partial<Record<TenantScopeTimeColumn, string>>;

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
   * WHERE predicate: the tenant marker first (the authorized reader expands it
   * into the proof's fence, ADR-177 block C), then the time window.
   */
  buildTimeWhere(
    timeColumn: keyof typeof FACET_TABLE_BY_TIME_COLUMN,
    ctx?: Pick<FacetQueryContext, "filterWhere" | "isLiveWindow">,
  ): string {
    const traceScope = ctx?.filterWhere
      ? scopeTraceFilterToTable({
          table: FACET_TABLE_BY_TIME_COLUMN[timeColumn],
          filterWhere: ctx.filterWhere,
          isLiveWindow: ctx.isLiveWindow === true,
        })
      : undefined;
    return [
      tenantScope(timeColumn),
      `${timeColumn} >= fromUnixTimestamp64Milli({timeFrom:Int64})`,
      `${timeColumn} <= fromUnixTimestamp64Milli({timeTo:Int64})`,
      ...(traceScope ? [traceScope.sql] : []),
    ].join(" AND ");
  }

  /**
   * The bound-parameter tuple every facet query relies on. Helpers that need
   * `prefix` add it on top, since not every builder supports key/value
   * prefix-filtering.
   */
  baseParams(ctx: FacetQueryContext): Record<string, unknown> {
    return {
      ...ctx.filterWhere?.params,
      timeFrom: ctx.timeRange.from,
      timeTo: ctx.timeRange.to,
      limit: ctx.limit,
      offset: ctx.offset,
    };
  }
}
