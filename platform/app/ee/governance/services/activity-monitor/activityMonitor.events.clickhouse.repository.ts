// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * ActivityMonitorEventsClickHouseRepository — per-source event listing and
 * counting for the /governance ingestion-source detail view (pushed traces,
 * pulled OCSF events, logged records).
 *
 * See `activityMonitor.clickhouse.schemas.ts` for the shared Zod schemas and
 * trust-boundary rationale.
 *
 * Pairs with: activityMonitor.service.ts (orchestration + PG queries)
 * Spec: specs/ai-gateway/governance/folds.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";

import {
  ATTR_INGESTION_SOURCE_ID,
  ATTR_INGESTION_SOURCE_TYPE,
  ATTR_ORIGIN_KIND,
  ATTR_USER_ID,
  ORIGIN_KIND_VALUE,
  type PulledEventChRow,
  type PushedEventChRow,
  pulledEventRowSchema,
  pushedEventRowSchema,
  type SourceEventCountChRow,
  sourceEventCountRowSchema,
} from "./activityMonitor.clickhouse.schemas";

export class ActivityMonitorEventsClickHouseRepository {
  /** Traced-event count per source, from `trace_summaries`. */
  async countTracedEventsBySource({
    ch,
    tenantId,
    sourceIds,
    since,
  }: {
    ch: ClickHouseClient;
    tenantId: string;
    sourceIds: string[];
    since: number;
  }): Promise<SourceEventCountChRow[]> {
    const result = await ch.query({
      query: `
        SELECT ts.Attributes[{sourceKey:String}] AS sourceId, toString(count()) AS c
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt >= fromUnixTimestamp64Milli({since:UInt64})
          AND ts.Attributes[{originKey:String}] = {originValue:String}
          AND ts.Attributes[{sourceKey:String}] IN ({sourceIds:Array(String)})
          AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              AND OccurredAt >= fromUnixTimestamp64Milli({since:UInt64})
            GROUP BY TenantId, TraceId
          )
        GROUP BY sourceId
      `,
      query_params: {
        tenantId,
        since,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
        sourceIds,
      },
      format: "JSONEachRow",
    });
    return sourceEventCountRowSchema.array().parse(await result.json());
  }

  /** Logged-record count per source, from `stored_log_records`. */
  async countLoggedEventsBySource({
    ch,
    tenantId,
    sourceIds,
    since,
  }: {
    ch: ClickHouseClient;
    tenantId: string;
    sourceIds: string[];
    since: number;
  }): Promise<SourceEventCountChRow[]> {
    const result = await ch.query({
      query: `
        SELECT lr.Attributes[{sourceKey:String}] AS sourceId, toString(count()) AS c
        FROM stored_log_records lr
        WHERE lr.TenantId = {tenantId:String}
          AND lr.TimeUnixMs >= fromUnixTimestamp64Milli({since:UInt64})
          AND lr.Attributes[{originKey:String}] = {originValue:String}
          AND lr.Attributes[{sourceKey:String}] IN ({sourceIds:Array(String)})
        GROUP BY sourceId
      `,
      query_params: {
        tenantId,
        since,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
        sourceIds,
      },
      format: "JSONEachRow",
    });
    return sourceEventCountRowSchema.array().parse(await result.json());
  }

  /** Pulled OCSF-event count per source, from `governance_ocsf_events`. */
  async countPulledEventsBySource({
    ch,
    tenantId,
    sourceIds,
    since,
  }: {
    ch: ClickHouseClient;
    tenantId: string;
    sourceIds: string[];
    since: number;
  }): Promise<SourceEventCountChRow[]> {
    const result = await ch.query({
      query: `
        SELECT SourceId AS sourceId, toString(count()) AS c
        FROM governance_ocsf_events
        WHERE TenantId = {tenantId:String}
          AND startsWith(TraceId, 'pull:')
          AND EventTime >= fromUnixTimestamp64Milli({since:UInt64})
          AND SourceId IN ({sourceIds:Array(String)})
          AND (TenantId, EventId, LastUpdatedAt) IN (
            SELECT TenantId, EventId, max(LastUpdatedAt)
            FROM governance_ocsf_events
            WHERE TenantId = {tenantId:String}
              AND startsWith(TraceId, 'pull:')
              AND EventTime >= fromUnixTimestamp64Milli({since:UInt64})
              AND SourceId IN ({sourceIds:Array(String)})
            GROUP BY TenantId, EventId
          )
        GROUP BY sourceId
      `,
      query_params: { tenantId, since, sourceIds },
      format: "JSONEachRow",
    });
    return sourceEventCountRowSchema.array().parse(await result.json());
  }

  /**
   * Paginated pushed-trace detail rows for one source, newest-first,
   * cursor-paged via `beforeMs`.
   */
  async findPushedEventsForSource({
    ch,
    tenantId,
    sourceId,
    beforeMs,
    limit,
  }: {
    ch: ClickHouseClient;
    tenantId: string;
    sourceId: string;
    beforeMs: number;
    limit: number;
  }): Promise<PushedEventChRow[]> {
    const result = await ch.query({
      query: `
        SELECT
          ts.TraceId AS eventId,
          ts.Attributes[{sourceTypeKey:String}] AS eventType,
          ts.Attributes[{userKey:String}] AS actor,
          arrayElement(ts.Models, 1) AS target,
          coalesce(ts.TotalCost, 0) AS costUsd,
          coalesce(ts.TotalPromptTokenCount, 0) AS tokensInput,
          coalesce(ts.TotalCompletionTokenCount, 0) AS tokensOutput,
          toString(toUnixTimestamp64Milli(ts.OccurredAt)) AS occurredMs,
          toString(toUnixTimestamp64Milli(ts.CreatedAt)) AS createdMs
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt < fromUnixTimestamp64Milli({beforeMs:UInt64})
          AND ts.Attributes[{originKey:String}] = {originValue:String}
          AND ts.Attributes[{sourceKey:String}] = {sourceId:String}
          AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              AND OccurredAt < fromUnixTimestamp64Milli({beforeMs:UInt64})
            GROUP BY TenantId, TraceId
          )
        ORDER BY ts.OccurredAt DESC, ts.TraceId DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId,
        beforeMs,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
        sourceTypeKey: ATTR_INGESTION_SOURCE_TYPE,
        userKey: ATTR_USER_ID,
        sourceId,
        limit,
      },
      format: "JSONEachRow",
    });
    return pushedEventRowSchema.array().parse(await result.json());
  }

  /**
   * Paginated pulled OCSF-event detail rows for one source, newest-first,
   * cursor-paged via `beforeMs`.
   */
  async findPulledEventsForSource({
    ch,
    tenantId,
    sourceId,
    beforeMs,
    limit,
  }: {
    ch: ClickHouseClient;
    tenantId: string;
    sourceId: string;
    beforeMs: number;
    limit: number;
  }): Promise<PulledEventChRow[]> {
    const result = await ch.query({
      query: `
        SELECT
          EventId AS eventId,
          SourceType AS eventType,
          ActorUserId AS actorUserId,
          ActorEmail AS actorEmail,
          ActorEnduserId AS actorEnduserId,
          ActionName AS action,
          TargetName AS target,
          toString(toUnixTimestamp64Milli(EventTime)) AS occurredMs,
          toString(toUnixTimestamp64Milli(CreatedAt)) AS createdMs,
          RawOcsfJson AS rawPayload
        FROM governance_ocsf_events
        WHERE TenantId = {tenantId:String}
          AND startsWith(TraceId, 'pull:')
          AND SourceId = {sourceId:String}
          AND EventTime < fromUnixTimestamp64Milli({beforeMs:UInt64})
          AND (TenantId, EventId, LastUpdatedAt) IN (
            SELECT TenantId, EventId, max(LastUpdatedAt)
            FROM governance_ocsf_events
            WHERE TenantId = {tenantId:String}
              AND startsWith(TraceId, 'pull:')
              AND SourceId = {sourceId:String}
              AND EventTime < fromUnixTimestamp64Milli({beforeMs:UInt64})
            GROUP BY TenantId, EventId
          )
        ORDER BY EventTime DESC, EventId DESC
        LIMIT {limit:UInt32}
      `,
      query_params: { tenantId, sourceId, beforeMs, limit },
      format: "JSONEachRow",
    });
    return pulledEventRowSchema.array().parse(await result.json());
  }
}
