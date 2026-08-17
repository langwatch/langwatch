// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * ActivityMonitorClickHouseRepository — read-side ClickHouse queries for the
 * /governance admin dashboard.
 *
 * Every query result is validated through a Zod schema before returning.
 * ClickHouse is a trust boundary: rows can carry nulls from JOINs, strings
 * for aggregated numerics (sum, count, uniqExact all return String in
 * JSONEachRow when the value is large), and silently renamed columns after
 * a migration. Zod `.parse()` at the read boundary catches all three;
 * `.catch()` on individual fields provides safe defaults for the expected
 * variations.
 *
 * Convention: Zod where untrusted data enters, `z.infer<>` for the type.
 * Internal orchestration contracts stay as plain `interface` in the service.
 *
 * Pairs with: activityMonitor.service.ts (orchestration + PG queries)
 * Spec: specs/ai-gateway/governance/folds.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { z } from "zod";

import {
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
} from "../governanceAttributeKeys";

// ---------------------------------------------------------------------------
// Shared types (service ↔ repository)
// ---------------------------------------------------------------------------

/** Sort field accepted by `spendByUser` / `spendByTeam`. */
export type SpendSortField = "spend" | "requests" | "lastActivity";
export type SortDir = "asc" | "desc";
export type SpendOverTimeGroupBy = "team" | "user" | "model";

// ---------------------------------------------------------------------------
// Attribute key constants
// ---------------------------------------------------------------------------

const ATTR_ORIGIN_KIND = GOVERNANCE_ATTR.ORIGIN_KIND;
const ATTR_INGESTION_SOURCE_ID = GOVERNANCE_ATTR.INGESTION_SOURCE_ID;
const ATTR_USER_ID = GOVERNANCE_ATTR.USER_ID;
const ORIGIN_KIND_VALUE = GOVERNANCE_ORIGIN_KIND_VALUE;

// ---------------------------------------------------------------------------
// SQL injection boundary — whitelist for ORDER BY interpolation
// ---------------------------------------------------------------------------

/**
 * Whitelist mapping from external sort field names to the aggregate
 * expressions we splice into the ORDER BY clause. CH parameter binding
 * does NOT support column-name interpolation; this whitelist is the
 * boundary that prevents injection through the public API.
 */
const SORT_FIELD_TO_AGG_EXPR: Record<SpendSortField, string> = {
  spend: "sum(spendUsd)",
  requests: "count()",
  lastActivity: "max(occurredAt)",
};

// ---------------------------------------------------------------------------
// Zod schemas — trust boundary between ClickHouse and application
// ---------------------------------------------------------------------------

/**
 * CH aggregates (sum, count, uniqExact) can return number or string in
 * JSONEachRow depending on the column type and value size. `z.coerce.number()`
 * handles both; `.finite()` rejects NaN/Infinity; `.catch(0)` defaults on
 * any parse failure.
 */
const chNumeric = z.coerce.number().finite().catch(0);

// -- 1. Summary spend --

const summarySpendRowSchema = z.object({
  thisSpend: chNumeric,
  prevSpend: chNumeric,
  thisUsers: chNumeric,
});
export type SummarySpendChRow = z.infer<typeof summarySpendRowSchema>;

const EMPTY_SUMMARY_SPEND: SummarySpendChRow = {
  thisSpend: 0,
  prevSpend: 0,
  thisUsers: 0,
};

// -- 2. Spend by user --

const spendByUserRowSchema = z.object({
  actor: z.string(),
  spendUsdStr: z.string(),
  requests: z.string(),
  lastActivityMs: z.string(),
  mostUsedTarget: z.string().nullable().catch(null),
});
export type SpendByUserChRow = z.infer<typeof spendByUserRowSchema>;

// -- 3. Spend by department (multi-tenant, per project×actor) --

const spendByDepartmentRowSchema = z.object({
  projectId: z.string(),
  actor: z.string(),
  spendUsdStr: z.string(),
  requests: z.string(),
  lastActivityMs: z.string(),
});
export type SpendByDepartmentChRow = z.infer<
  typeof spendByDepartmentRowSchema
>;

// -- 4. Spend by team source --

const spendByTeamSourceRowSchema = z.object({
  sourceId: z.string(),
  thisSpendStr: z.string(),
  prevSpendStr: z.string(),
  thisRequests: z.string(),
  lastActivityMs: z.string(),
});
export type SpendByTeamSourceChRow = z.infer<
  typeof spendByTeamSourceRowSchema
>;

// -- 5. Spend over time --

const spendOverTimeRowSchema = z.object({
  bucketMs: z.string(),
  groupKey: z.string().nullable().catch(null),
  spendUsdStr: z.string(),
});
export type SpendOverTimeChRow = z.infer<typeof spendOverTimeRowSchema>;

// -- 6–8. Source event counts --

const sourceEventCountRowSchema = z.object({
  sourceId: z.string(),
  c: z.string(),
});
export type SourceEventCountChRow = z.infer<typeof sourceEventCountRowSchema>;

// -- 9. Pushed event details --

const pushedEventRowSchema = z.object({
  eventId: z.string(),
  eventType: z.string().catch(""),
  actor: z.string().catch(""),
  target: z.string().nullable().catch(null),
  costUsd: z
    .union([z.string(), z.number()])
    .transform(String)
    .catch("0"),
  tokensInput: chNumeric,
  tokensOutput: chNumeric,
  occurredMs: z.string(),
  createdMs: z.string(),
});
export type PushedEventChRow = z.infer<typeof pushedEventRowSchema>;

// -- 10. Pulled event details --

const pulledEventRowSchema = z.object({
  eventId: z.string(),
  eventType: z.string().catch(""),
  actorUserId: z.string().catch(""),
  actorEmail: z.string().catch(""),
  actorEnduserId: z.string().catch(""),
  action: z.string().catch(""),
  target: z.string().catch(""),
  occurredMs: z.string(),
  createdMs: z.string(),
  rawPayload: z.string().catch(""),
});
export type PulledEventChRow = z.infer<typeof pulledEventRowSchema>;

// -- 11–13. Window counts (24h/7d/30d) --

const windowCountRowSchema = z.object({
  c24: chNumeric,
  c7: chNumeric,
  c30: chNumeric,
  lastMs: z.string().nullable().catch(null),
});
export type WindowCountChRow = z.infer<typeof windowCountRowSchema>;

// ---------------------------------------------------------------------------
// Repository class
// ---------------------------------------------------------------------------

export class ActivityMonitorClickHouseRepository {
  /**
   * Summary aggregation: total spend in current + previous windows, active
   * user count. Returns a single row (CH aggregates always produce one).
   */
  async findSummarySpend(
    ch: ClickHouseClient,
    params: { tenantId: string; thisStart: number; prevStart: number },
  ): Promise<SummarySpendChRow> {
    const result = await ch.query({
      query: `
        SELECT
          sumIf(coalesce(ts.TotalCost, 0), ts.OccurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64})) AS thisSpend,
          sumIf(coalesce(ts.TotalCost, 0), ts.OccurredAt < fromUnixTimestamp64Milli({thisStart:UInt64})) AS prevSpend,
          uniqExactIf(
            ts.Attributes[{userKey:String}],
            ts.OccurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64})
              AND ts.Attributes[{userKey:String}] != ''
          ) AS thisUsers
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt >= fromUnixTimestamp64Milli({prevStart:UInt64})
          AND ts.Attributes[{originKey:String}] = {originValue:String}
          AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              AND OccurredAt >= fromUnixTimestamp64Milli({prevStart:UInt64})
            GROUP BY TenantId, TraceId
          )
      `,
      query_params: {
        tenantId: params.tenantId,
        thisStart: params.thisStart,
        prevStart: params.prevStart,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        userKey: ATTR_USER_ID,
      },
      format: "JSONEachRow",
    });
    const rows = summarySpendRowSchema
      .array()
      .parse(await result.json());
    return rows[0] ?? EMPTY_SUMMARY_SPEND;
  }

  /**
   * Per-user spend rollup with pagination + sort.
   *
   * ClickHouse 25.x resolves bare column names in ORDER BY to outer
   * aliases when the alias shadows a subquery column — so
   * `ORDER BY sum(spendUsd)` against an outer alias of `spendUsd =
   * toString(sum(...))` evaluates as sum-over-String and fails with
   * ILLEGAL_TYPE_OF_ARGUMENT (43). Aliasing the outer string to a
   * disjoint name (`spendUsdStr`) keeps the ORDER BY referring to the
   * subquery's Float64 spendUsd column.
   */
  async findSpendByUser(
    ch: ClickHouseClient,
    params: {
      tenantId: string;
      windowStart: number;
      sortBy: SpendSortField;
      sortDir: SortDir;
      limit: number;
      offset: number;
    },
  ): Promise<SpendByUserChRow[]> {
    const orderExpr = SORT_FIELD_TO_AGG_EXPR[params.sortBy];
    const orderDir = params.sortDir === "asc" ? "ASC" : "DESC";

    const result = await ch.query({
      query: `
        SELECT
          actor,
          toString(sum(spendUsd)) AS spendUsdStr,
          toString(count()) AS requests,
          toString(toUnixTimestamp64Milli(max(occurredAt))) AS lastActivityMs,
          any(model) AS mostUsedTarget
        FROM (
          SELECT
            ts.Attributes[{userKey:String}] AS actor,
            coalesce(ts.TotalCost, 0) AS spendUsd,
            ts.OccurredAt AS occurredAt,
            arrayElement(ts.Models, 1) AS model
          FROM trace_summaries ts
          WHERE ts.TenantId = {tenantId:String}
            AND ts.OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
            AND ts.Attributes[{originKey:String}] = {originValue:String}
            AND ts.Attributes[{userKey:String}] != ''
            AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
              SELECT TenantId, TraceId, max(UpdatedAt)
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
              GROUP BY TenantId, TraceId
            )
        )
        GROUP BY actor
        ORDER BY ${orderExpr} ${orderDir}
        LIMIT {limit:UInt32} OFFSET {offset:UInt32}
      `,
      query_params: {
        tenantId: params.tenantId,
        windowStart: params.windowStart,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        userKey: ATTR_USER_ID,
        limit: params.limit,
        offset: params.offset,
      },
      format: "JSONEachRow",
    });
    return spendByUserRowSchema.array().parse(await result.json());
  }

  /**
   * Per-(projectId, actor) spend for the department rollup. Multi-tenant:
   * queries across all org projects so the department bird's-eye view
   * aggregates the whole org's AI spend.
   */
  async findSpendByDepartment(
    ch: ClickHouseClient,
    params: { tenantIds: string[]; windowStart: number },
  ): Promise<SpendByDepartmentChRow[]> {
    const result = await ch.query({
      query: `
        SELECT
          ts.TenantId AS projectId,
          ts.Attributes[{userKey:String}] AS actor,
          toString(sum(coalesce(ts.TotalCost, 0))) AS spendUsdStr,
          toString(count()) AS requests,
          toString(toUnixTimestamp64Milli(max(ts.OccurredAt))) AS lastActivityMs
        FROM trace_summaries ts
        WHERE ts.TenantId IN ({tenantIds:Array(String)})
          AND ts.OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
          AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM trace_summaries
            WHERE TenantId IN ({tenantIds:Array(String)})
              AND OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
            GROUP BY TenantId, TraceId
          )
        GROUP BY projectId, actor
      `,
      query_params: {
        tenantIds: params.tenantIds,
        windowStart: params.windowStart,
        userKey: ATTR_USER_ID,
      },
      format: "JSONEachRow",
    });
    return spendByDepartmentRowSchema.array().parse(await result.json());
  }

  /**
   * Per-source spend with prior-window comparison. The service rolls these
   * up by team via a PG join (CH only sees sourceId).
   */
  async findSpendByTeamSource(
    ch: ClickHouseClient,
    params: { tenantId: string; thisStart: number; prevStart: number },
  ): Promise<SpendByTeamSourceChRow[]> {
    const result = await ch.query({
      query: `
        SELECT
          sourceId,
          toString(sumIf(spendUsd, occurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64}))) AS thisSpendStr,
          toString(sumIf(spendUsd, occurredAt < fromUnixTimestamp64Milli({thisStart:UInt64}))) AS prevSpendStr,
          toString(countIf(occurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64}))) AS thisRequests,
          toString(toUnixTimestamp64Milli(maxIf(occurredAt, occurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64})))) AS lastActivityMs
        FROM (
          SELECT
            ts.Attributes[{sourceKey:String}] AS sourceId,
            coalesce(ts.TotalCost, 0) AS spendUsd,
            ts.OccurredAt AS occurredAt
          FROM trace_summaries ts
          WHERE ts.TenantId = {tenantId:String}
            AND ts.OccurredAt >= fromUnixTimestamp64Milli({prevStart:UInt64})
            AND ts.Attributes[{originKey:String}] = {originValue:String}
            AND ts.Attributes[{sourceKey:String}] != ''
            AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
              SELECT TenantId, TraceId, max(UpdatedAt)
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND OccurredAt >= fromUnixTimestamp64Milli({prevStart:UInt64})
              GROUP BY TenantId, TraceId
            )
        )
        GROUP BY sourceId
      `,
      query_params: {
        tenantId: params.tenantId,
        thisStart: params.thisStart,
        prevStart: params.prevStart,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
      },
      format: "JSONEachRow",
    });
    return spendByTeamSourceRowSchema.array().parse(await result.json());
  }

  /**
   * Bucketed daily spend grouped by team / user / model for the
   * spend-over-time stacked-area chart.
   */
  async findSpendOverTime(
    ch: ClickHouseClient,
    params: {
      tenantId: string;
      windowStart: number;
      groupBy: SpendOverTimeGroupBy;
    },
  ): Promise<SpendOverTimeChRow[]> {
    const groupExpr =
      params.groupBy === "team"
        ? `ts.Attributes[{sourceKey:String}]`
        : params.groupBy === "user"
          ? `ts.Attributes[{userKey:String}]`
          : `arrayElement(ts.Models, 1)`;

    // `OccurredAt` is DateTime64(3, 'UTC'). `toStartOfDay()` returns
    // plain `DateTime` (seconds resolution), and `toUnixTimestamp64Milli`
    // refuses anything but DateTime64 — so we go the other way:
    // `toUnixTimestamp()` gives seconds, then multiply by 1000 to get
    // millisecond ticks.
    const result = await ch.query({
      query: `
        SELECT
          toString(toUnixTimestamp(toStartOfDay(ts.OccurredAt)) * 1000) AS bucketMs,
          ${groupExpr} AS groupKey,
          toString(sum(coalesce(ts.TotalCost, 0))) AS spendUsdStr
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
          AND ts.Attributes[{originKey:String}] = {originValue:String}
          AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              AND OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
            GROUP BY TenantId, TraceId
          )
        GROUP BY bucketMs, groupKey
        ORDER BY bucketMs ASC
      `,
      query_params: {
        tenantId: params.tenantId,
        windowStart: params.windowStart,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
        userKey: ATTR_USER_ID,
      },
      format: "JSONEachRow",
    });
    return spendOverTimeRowSchema.array().parse(await result.json());
  }

  // -----------------------------------------------------------------------
  // Per-source event counts (three tables: traces, logs, pulled OCSF)
  // -----------------------------------------------------------------------

  async countTracedEventsBySource(
    ch: ClickHouseClient,
    params: { tenantId: string; sourceIds: string[]; since: number },
  ): Promise<SourceEventCountChRow[]> {
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
        tenantId: params.tenantId,
        since: params.since,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
        sourceIds: params.sourceIds,
      },
      format: "JSONEachRow",
    });
    return sourceEventCountRowSchema.array().parse(await result.json());
  }

  async countLoggedEventsBySource(
    ch: ClickHouseClient,
    params: { tenantId: string; sourceIds: string[]; since: number },
  ): Promise<SourceEventCountChRow[]> {
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
        tenantId: params.tenantId,
        since: params.since,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
        sourceIds: params.sourceIds,
      },
      format: "JSONEachRow",
    });
    return sourceEventCountRowSchema.array().parse(await result.json());
  }

  async countPulledEventsBySource(
    ch: ClickHouseClient,
    params: { tenantId: string; sourceIds: string[]; since: number },
  ): Promise<SourceEventCountChRow[]> {
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
      query_params: {
        tenantId: params.tenantId,
        since: params.since,
        sourceIds: params.sourceIds,
      },
      format: "JSONEachRow",
    });
    return sourceEventCountRowSchema.array().parse(await result.json());
  }

  // -----------------------------------------------------------------------
  // Per-source event details (pushed traces + pulled OCSF)
  // -----------------------------------------------------------------------

  async findPushedEventsForSource(
    ch: ClickHouseClient,
    params: {
      tenantId: string;
      sourceId: string;
      beforeMs: number;
      limit: number;
    },
  ): Promise<PushedEventChRow[]> {
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
            GROUP BY TenantId, TraceId
          )
        ORDER BY ts.OccurredAt DESC, ts.TraceId DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: params.tenantId,
        beforeMs: params.beforeMs,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
        sourceTypeKey: GOVERNANCE_ATTR.INGESTION_SOURCE_TYPE,
        userKey: ATTR_USER_ID,
        sourceId: params.sourceId,
        limit: params.limit,
      },
      format: "JSONEachRow",
    });
    return pushedEventRowSchema.array().parse(await result.json());
  }

  async findPulledEventsForSource(
    ch: ClickHouseClient,
    params: {
      tenantId: string;
      sourceId: string;
      beforeMs: number;
      limit: number;
    },
  ): Promise<PulledEventChRow[]> {
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
      query_params: {
        tenantId: params.tenantId,
        sourceId: params.sourceId,
        beforeMs: params.beforeMs,
        limit: params.limit,
      },
      format: "JSONEachRow",
    });
    return pulledEventRowSchema.array().parse(await result.json());
  }

  // -----------------------------------------------------------------------
  // Per-source window counts (24h / 7d / 30d)
  // -----------------------------------------------------------------------

  async findTracedEventWindowCounts(
    ch: ClickHouseClient,
    params: {
      tenantId: string;
      sourceId: string;
      since24h: number;
      since7d: number;
      since30d: number;
    },
  ): Promise<WindowCountChRow | undefined> {
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
        tenantId: params.tenantId,
        since24h: params.since24h,
        since7d: params.since7d,
        since30d: params.since30d,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
        sourceId: params.sourceId,
      },
      format: "JSONEachRow",
    });
    const rows = windowCountRowSchema
      .array()
      .parse(await result.json());
    return rows[0];
  }

  async findLoggedEventWindowCounts(
    ch: ClickHouseClient,
    params: {
      tenantId: string;
      sourceId: string;
      since24h: number;
      since7d: number;
      since30d: number;
    },
  ): Promise<WindowCountChRow | undefined> {
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
        tenantId: params.tenantId,
        since24h: params.since24h,
        since7d: params.since7d,
        since30d: params.since30d,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
        sourceId: params.sourceId,
      },
      format: "JSONEachRow",
    });
    const rows = windowCountRowSchema
      .array()
      .parse(await result.json());
    return rows[0];
  }

  async findPulledEventWindowCounts(
    ch: ClickHouseClient,
    params: {
      tenantId: string;
      sourceId: string;
      since24h: number;
      since7d: number;
      since30d: number;
    },
  ): Promise<WindowCountChRow | undefined> {
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
      query_params: {
        tenantId: params.tenantId,
        since24h: params.since24h,
        since7d: params.since7d,
        since30d: params.since30d,
        sourceId: params.sourceId,
      },
      format: "JSONEachRow",
    });
    const rows = windowCountRowSchema
      .array()
      .parse(await result.json());
    return rows[0];
  }
}
