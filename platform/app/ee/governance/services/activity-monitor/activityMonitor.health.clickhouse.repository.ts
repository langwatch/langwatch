// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * ActivityMonitorHealthClickHouseRepository — 24h/7d/30d window counts for
 * the /governance ingestion-source health indicator (traced, logged, pulled).
 *
 * See `activityMonitor.clickhouse.schemas.ts` for the shared Zod schemas and
 * trust-boundary rationale.
 *
 * Pairs with: activityMonitor.service.ts (orchestration + PG queries)
 * Spec: specs/ai-gateway/governance/folds.feature
 */
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";

import {
  ATTR_INGESTION_SOURCE_ID,
  ATTR_ORIGIN_KIND,
  ORIGIN_KIND_VALUE,
  type WindowCountChRow,
  windowCountRowSchema,
} from "./activityMonitor.clickhouse.schemas";

export class ActivityMonitorHealthClickHouseRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  /** Traced-event window counts (24h/7d/30d) for one source, from `trace_summaries`. */
  async findTracedEventWindowCounts({
    tenantId,
    sourceId,
    since24h,
    since7d,
    since30d,
  }: {
    tenantId: string;
    sourceId: string;
    since24h: number;
    since7d: number;
    since30d: number;
  }): Promise<WindowCountChRow | undefined> {
    const ch = await this.resolveClient(tenantId);
    const result = await ch.query({
      query: `
        SELECT
          countIf(ts.OccurredAt >= fromUnixTimestamp64Milli({since24h:UInt64})) AS c24,
          countIf(ts.OccurredAt >= fromUnixTimestamp64Milli({since7d:UInt64})) AS c7,
          count() AS c30,
          toString(toUnixTimestamp64Milli(max(ts.OccurredAt))) AS lastMs
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt >= fromUnixTimestamp64Milli({since30d:UInt64})
          AND ts.Attributes[{originKey:String}] = {originValue:String}
          AND ts.Attributes[{sourceKey:String}] = {sourceId:String}
          AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              AND OccurredAt >= fromUnixTimestamp64Milli({since30d:UInt64})
            GROUP BY TenantId, TraceId
          )
      `,
      query_params: {
        tenantId,
        since24h,
        since7d,
        since30d,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
        sourceId,
      },
      format: "JSONEachRow",
    });
    const rows = windowCountRowSchema.array().parse(await result.json());
    return rows[0];
  }

  /** Logged-record window counts (24h/7d/30d) for one source, from `stored_log_records`. */
  async findLoggedEventWindowCounts({
    tenantId,
    sourceId,
    since24h,
    since7d,
    since30d,
  }: {
    tenantId: string;
    sourceId: string;
    since24h: number;
    since7d: number;
    since30d: number;
  }): Promise<WindowCountChRow | undefined> {
    const ch = await this.resolveClient(tenantId);
    const result = await ch.query({
      query: `
        SELECT
          countIf(lr.TimeUnixMs >= fromUnixTimestamp64Milli({since24h:UInt64})) AS c24,
          countIf(lr.TimeUnixMs >= fromUnixTimestamp64Milli({since7d:UInt64})) AS c7,
          count() AS c30,
          toString(toUnixTimestamp64Milli(max(lr.TimeUnixMs))) AS lastMs
        FROM stored_log_records lr
        WHERE lr.TenantId = {tenantId:String}
          AND lr.TimeUnixMs >= fromUnixTimestamp64Milli({since30d:UInt64})
          AND lr.Attributes[{originKey:String}] = {originValue:String}
          AND lr.Attributes[{sourceKey:String}] = {sourceId:String}
      `,
      query_params: {
        tenantId,
        since24h,
        since7d,
        since30d,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
        sourceId,
      },
      format: "JSONEachRow",
    });
    const rows = windowCountRowSchema.array().parse(await result.json());
    return rows[0];
  }

  /** Pulled OCSF-event window counts (24h/7d/30d) for one source. */
  async findPulledEventWindowCounts({
    tenantId,
    sourceId,
    since24h,
    since7d,
    since30d,
  }: {
    tenantId: string;
    sourceId: string;
    since24h: number;
    since7d: number;
    since30d: number;
  }): Promise<WindowCountChRow | undefined> {
    const ch = await this.resolveClient(tenantId);
    const result = await ch.query({
      query: `
        SELECT
          countIf(EventTime >= fromUnixTimestamp64Milli({since24h:UInt64})) AS c24,
          countIf(EventTime >= fromUnixTimestamp64Milli({since7d:UInt64})) AS c7,
          count() AS c30,
          toString(toUnixTimestamp64Milli(max(EventTime))) AS lastMs
        FROM governance_ocsf_events
        WHERE TenantId = {tenantId:String}
          AND startsWith(TraceId, 'pull:')
          AND SourceId = {sourceId:String}
          AND EventTime >= fromUnixTimestamp64Milli({since30d:UInt64})
          AND (TenantId, EventId, LastUpdatedAt) IN (
            SELECT TenantId, EventId, max(LastUpdatedAt)
            FROM governance_ocsf_events
            WHERE TenantId = {tenantId:String}
              AND startsWith(TraceId, 'pull:')
              AND SourceId = {sourceId:String}
              AND EventTime >= fromUnixTimestamp64Milli({since30d:UInt64})
            GROUP BY TenantId, EventId
          )
      `,
      query_params: { tenantId, sourceId, since24h, since7d, since30d },
      format: "JSONEachRow",
    });
    const rows = windowCountRowSchema.array().parse(await result.json());
    return rows[0];
  }
}
