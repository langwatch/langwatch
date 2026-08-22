// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * ActivityMonitorSpendClickHouseRepository — spend-rollup ClickHouse queries
 * for the /governance admin dashboard (summary, by-user, by-department,
 * by-team-source, over-time).
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
  ATTR_ORIGIN_KIND,
  ATTR_USER_ID,
  EMPTY_SUMMARY_SPEND,
  ORIGIN_KIND_VALUE,
  SORT_FIELD_TO_AGG_EXPR,
  type SortDir,
  type SpendByDepartmentChRow,
  type SpendByTeamSourceChRow,
  type SpendByUserChRow,
  type SpendOverTimeChRow,
  type SpendOverTimeGroupBy,
  type SpendSortField,
  type SummarySpendChRow,
  spendByDepartmentRowSchema,
  spendByTeamSourceRowSchema,
  spendByUserRowSchema,
  spendOverTimeRowSchema,
  summarySpendRowSchema,
} from "./activityMonitor.clickhouse.schemas";

export class ActivityMonitorSpendClickHouseRepository {
  /**
   * Summary aggregation: total spend in current + previous windows, active
   * user count. Returns a single row (CH aggregates always produce one).
   */
  async findSummarySpend({
    ch,
    tenantId,
    thisStart,
    prevStart,
  }: {
    ch: ClickHouseClient;
    tenantId: string;
    thisStart: number;
    prevStart: number;
  }): Promise<SummarySpendChRow> {
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
        tenantId,
        thisStart,
        prevStart,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        userKey: ATTR_USER_ID,
      },
      format: "JSONEachRow",
    });
    const rows = summarySpendRowSchema.array().parse(await result.json());
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
  async findSpendByUser({
    ch,
    tenantId,
    windowStart,
    sortBy,
    sortDir,
    limit,
    offset,
  }: {
    ch: ClickHouseClient;
    tenantId: string;
    windowStart: number;
    sortBy: SpendSortField;
    sortDir: SortDir;
    limit: number;
    offset: number;
  }): Promise<SpendByUserChRow[]> {
    // Fails closed: SORT_FIELD_TO_AGG_EXPR is Record<SpendSortField, string>
    // so this is exhaustive at compile time, but sortBy crosses a tRPC
    // boundary — an erased/loosened type upstream must never turn into an
    // interpolated `undefined` in the ORDER BY clause.
    const orderExpr =
      SORT_FIELD_TO_AGG_EXPR[sortBy] ?? SORT_FIELD_TO_AGG_EXPR.spend;
    const orderDir = sortDir === "asc" ? "ASC" : "DESC";

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
        tenantId,
        windowStart,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        userKey: ATTR_USER_ID,
        limit,
        offset,
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
  async findSpendByDepartment({
    ch,
    tenantIds,
    windowStart,
  }: {
    ch: ClickHouseClient;
    tenantIds: string[];
    windowStart: number;
  }): Promise<SpendByDepartmentChRow[]> {
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
        tenantIds,
        windowStart,
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
  async findSpendByTeamSource({
    ch,
    tenantId,
    thisStart,
    prevStart,
  }: {
    ch: ClickHouseClient;
    tenantId: string;
    thisStart: number;
    prevStart: number;
  }): Promise<SpendByTeamSourceChRow[]> {
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
        tenantId,
        thisStart,
        prevStart,
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
  async findSpendOverTime({
    ch,
    tenantId,
    windowStart,
    groupBy,
  }: {
    ch: ClickHouseClient;
    tenantId: string;
    windowStart: number;
    groupBy: SpendOverTimeGroupBy;
  }): Promise<SpendOverTimeChRow[]> {
    const groupExpr =
      groupBy === "team"
        ? `ts.Attributes[{sourceKey:String}]`
        : groupBy === "user"
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
        tenantId,
        windowStart,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
        userKey: ATTR_USER_ID,
      },
      format: "JSONEachRow",
    });
    return spendOverTimeRowSchema.array().parse(await result.json());
  }
}
