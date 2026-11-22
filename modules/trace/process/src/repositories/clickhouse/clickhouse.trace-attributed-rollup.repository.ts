import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type {
  TraceAttributedRecency,
  TraceAttributedSpendComparison,
  TraceAttributedSpendSort,
  TraceAttributedTraceDetail,
  TraceAttributedValueComparison,
  TraceAttributedValueSpend,
  TraceAttributeMatch,
  TraceDailyGroupSpend,
  TraceDailySpendGroup,
  TraceModelSpendWindow,
  TraceProjectValueSpend,
} from "@langwatch/trace-contract";

import { TraceAttributedRollupRepository } from "../trace-attributed-rollup.repository.ts";

/** A spend rollup's ceiling on threads and runtime (#8072 step 3, as on main). */
const SPEND_ROLLUP_SETTINGS = { max_threads: 2, max_execution_time: 45 };

/** Sort keys to the aggregate they order by; never interpolated from caller text. */
const SORT_EXPRESSION: Record<TraceAttributedSpendSort, string> = {
  spend: "sum(spendUsd)",
  requests: "count()",
  lastActivity: "max(occurredAt)",
};

type Numeric = number | string | null;

/** `AND ts.Attributes[key] = value` per match, bound as parameters. */
function matchClause(matches: readonly TraceAttributeMatch[]) {
  const params: Record<string, string> = {};
  const sql = matches
    .map((match, index) => {
      params[`matchKey${index}`] = match.key;
      params[`matchValue${index}`] = match.value;
      return `AND ts.Attributes[{matchKey${index}:String}] = {matchValue${index}:String}`;
    })
    .join("\n            ");
  return { sql, params };
}

/** The latest version of each trace in the tenant's `OccurredAt` range. */
function latestVersion(where: string): string {
  return `(ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
              SELECT TenantId, TraceId, max(UpdatedAt)
              FROM trace_summaries
              WHERE ${where}
              GROUP BY TenantId, TraceId
            )`;
}

const SINGLE_TENANT_RANGE = `TenantId = {tenantId:String}
                AND OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
                AND OccurredAt < fromUnixTimestamp64Milli({windowEnd:UInt64})`;

/** Main's governance activity-monitor reads, answered by trace over trace_summaries. */
export class ClickHouseTraceAttributedRollupRepository extends TraceAttributedRollupRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): ClickHouseTraceAttributedRollupRepository {
    return new ClickHouseTraceAttributedRollupRepository(clickhouse);
  }

  async getAttributedSpendComparison(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    actorKey: string;
    previousStartMs: number;
    currentStartMs: number;
    endMs: number;
  }): Promise<TraceAttributedSpendComparison> {
    const match = matchClause(input.matches);
    const result = await this.#clickhouse.query<{
      thisSpend: Numeric;
      prevSpend: Numeric;
      thisUsers: Numeric;
    }>({
      tenantId: input.tenantId,
      table: "trace_summaries",
      settings: SPEND_ROLLUP_SETTINGS,
      sql: `
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
          AND ts.OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
          AND ts.OccurredAt < fromUnixTimestamp64Milli({windowEnd:UInt64})
          ${match.sql}
          AND ${latestVersion(SINGLE_TENANT_RANGE)}
      `,
      params: {
        ...match.params,
        tenantId: input.tenantId,
        windowStart: input.previousStartMs,
        windowEnd: input.endMs,
        thisStart: input.currentStartMs,
        userKey: input.actorKey,
      },
    });
    const row = result.rows[0];
    return {
      currentSpendUsd: Number(row?.thisSpend ?? 0),
      previousSpendUsd: Number(row?.prevSpend ?? 0),
      currentActors: Number(row?.thisUsers ?? 0),
    };
  }

  async findAttributedSpendByValue(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    valueKey: string;
    window: TraceModelSpendWindow;
    sortBy: TraceAttributedSpendSort;
    sortDirection: "asc" | "desc";
    limit: number;
    offset: number;
  }): Promise<TraceAttributedValueSpend[]> {
    const match = matchClause(input.matches);
    const orderExpression = SORT_EXPRESSION[input.sortBy];
    const orderDirection = input.sortDirection === "asc" ? "ASC" : "DESC";
    // The outer string alias is disjoint from the inner `spendUsd`, so ORDER BY sums the Float64.
    const result = await this.#clickhouse.query<{
      actor: string;
      spendUsdStr: string;
      requests: Numeric;
      lastActivityMs: Numeric;
      mostUsedTarget: string | null;
    }>({
      tenantId: input.tenantId,
      table: "trace_summaries",
      settings: SPEND_ROLLUP_SETTINGS,
      sql: `
        SELECT
          actor,
          toString(sum(spendUsd)) AS spendUsdStr,
          toString(count()) AS requests,
          toString(toUnixTimestamp64Milli(max(occurredAt))) AS lastActivityMs,
          any(model) AS mostUsedTarget
        FROM (
          SELECT
            ts.Attributes[{valueKey:String}] AS actor,
            coalesce(ts.TotalCost, 0) AS spendUsd,
            ts.OccurredAt AS occurredAt,
            arrayElement(ts.Models, 1) AS model
          FROM trace_summaries ts
          WHERE ts.TenantId = {tenantId:String}
            AND ts.OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
            AND ts.OccurredAt < fromUnixTimestamp64Milli({windowEnd:UInt64})
            ${match.sql}
            AND ts.Attributes[{valueKey:String}] != ''
            AND ${latestVersion(SINGLE_TENANT_RANGE)}
        )
        GROUP BY actor
        ORDER BY ${orderExpression} ${orderDirection}
        LIMIT {limit:UInt32} OFFSET {offset:UInt32}
      `,
      params: {
        ...match.params,
        tenantId: input.tenantId,
        windowStart: input.window.startMs,
        windowEnd: input.window.endMs,
        valueKey: input.valueKey,
        limit: input.limit,
        offset: Math.max(0, input.offset),
      },
    });
    return result.rows.map((row) => ({
      value: row.actor,
      spentUsd: row.spendUsdStr,
      requests: Number(row.requests),
      lastOccurredAtMs: Number(row.lastActivityMs),
      firstModel: row.mostUsedTarget ?? "",
    }));
  }

  async findAttributedSpendComparisonByValue(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    valueKey: string;
    previousStartMs: number;
    currentStartMs: number;
    endMs: number;
  }): Promise<TraceAttributedValueComparison[]> {
    const match = matchClause(input.matches);
    const result = await this.#clickhouse.query<{
      sourceId: string;
      thisSpendStr: string;
      prevSpendStr: string;
      thisRequests: Numeric;
      lastActivityMs: Numeric;
    }>({
      tenantId: input.tenantId,
      table: "trace_summaries",
      settings: SPEND_ROLLUP_SETTINGS,
      sql: `
        SELECT
          sourceId,
          toString(sumIf(spendUsd, occurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64}))) AS thisSpendStr,
          toString(sumIf(spendUsd, occurredAt < fromUnixTimestamp64Milli({thisStart:UInt64}))) AS prevSpendStr,
          toString(countIf(occurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64}))) AS thisRequests,
          toString(toUnixTimestamp64Milli(maxIf(occurredAt, occurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64})))) AS lastActivityMs
        FROM (
          SELECT
            ts.Attributes[{valueKey:String}] AS sourceId,
            coalesce(ts.TotalCost, 0) AS spendUsd,
            ts.OccurredAt AS occurredAt
          FROM trace_summaries ts
          WHERE ts.TenantId = {tenantId:String}
            AND ts.OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
            AND ts.OccurredAt < fromUnixTimestamp64Milli({windowEnd:UInt64})
            ${match.sql}
            AND ts.Attributes[{valueKey:String}] != ''
            AND ${latestVersion(SINGLE_TENANT_RANGE)}
        )
        GROUP BY sourceId
      `,
      params: {
        ...match.params,
        tenantId: input.tenantId,
        windowStart: input.previousStartMs,
        windowEnd: input.endMs,
        thisStart: input.currentStartMs,
        valueKey: input.valueKey,
      },
    });
    return result.rows.map((row) => ({
      value: row.sourceId,
      currentSpendUsd: row.thisSpendStr,
      previousSpendUsd: row.prevSpendStr,
      currentRequests: Number(row.thisRequests),
      lastCurrentOccurredAtMs: Number(row.lastActivityMs),
    }));
  }

  async findSpendByProjectAndValue(input: {
    tenantIds: readonly string[];
    valueKey: string;
    window: TraceModelSpendWindow;
  }): Promise<TraceProjectValueSpend[]> {
    const [firstTenantId] = input.tenantIds;
    if (firstTenantId === undefined) return [];
    // A declared tenant set (ARCHITECTURE.md "Routing is folded into the `clickhouse` member").
    const placeholders = input.tenantIds.map((_, index) => `{tenant${index}:String}`).join(", ");
    const tenantParams = Object.fromEntries(
      input.tenantIds.map((id, index) => [`tenant${index}`, id]),
    );
    const result = await this.#clickhouse.query<{
      projectId: string;
      actor: string;
      spendUsdStr: string;
      requests: Numeric;
      lastActivityMs: Numeric;
    }>({
      tenantId: firstTenantId,
      tenantIds: input.tenantIds,
      table: "trace_summaries",
      settings: SPEND_ROLLUP_SETTINGS,
      sql: `
        SELECT
          ts.TenantId AS projectId,
          ts.Attributes[{valueKey:String}] AS actor,
          toString(sum(coalesce(ts.TotalCost, 0))) AS spendUsdStr,
          toString(count()) AS requests,
          toString(toUnixTimestamp64Milli(max(ts.OccurredAt))) AS lastActivityMs
        FROM trace_summaries ts
        WHERE ts.TenantId IN (${placeholders})
          AND ts.OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
          AND ts.OccurredAt < fromUnixTimestamp64Milli({windowEnd:UInt64})
          AND ${latestVersion(`TenantId IN (${placeholders})
                AND OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
                AND OccurredAt < fromUnixTimestamp64Milli({windowEnd:UInt64})`)}
        GROUP BY projectId, actor
      `,
      params: {
        ...tenantParams,
        windowStart: input.window.startMs,
        windowEnd: input.window.endMs,
        valueKey: input.valueKey,
      },
    });
    return result.rows.map((row) => ({
      projectId: row.projectId,
      value: row.actor,
      spentUsd: row.spendUsdStr,
      requests: Number(row.requests),
      lastOccurredAtMs: Number(row.lastActivityMs),
    }));
  }

  async findDailyAttributedSpend(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    groupBy: TraceDailySpendGroup;
    window: TraceModelSpendWindow;
  }): Promise<TraceDailyGroupSpend[]> {
    const match = matchClause(input.matches);
    const groupExpression =
      input.groupBy.kind === "attribute"
        ? "ts.Attributes[{groupKey:String}]"
        : "arrayElement(ts.Models, 1)";
    // toStartOfDay gives a DateTime, which toUnixTimestamp64Milli refuses: seconds times 1000.
    const result = await this.#clickhouse.query<{
      bucketMs: Numeric;
      groupKey: string | null;
      spendUsdStr: string;
    }>({
      tenantId: input.tenantId,
      table: "trace_summaries",
      settings: SPEND_ROLLUP_SETTINGS,
      sql: `
        SELECT
          toString(toUnixTimestamp(toStartOfDay(ts.OccurredAt)) * 1000) AS bucketMs,
          ${groupExpression} AS groupKey,
          toString(sum(coalesce(ts.TotalCost, 0))) AS spendUsdStr
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
          AND ts.OccurredAt < fromUnixTimestamp64Milli({windowEnd:UInt64})
          ${match.sql}
          AND ${latestVersion(SINGLE_TENANT_RANGE)}
        GROUP BY bucketMs, groupKey
        ORDER BY bucketMs ASC
      `,
      params: {
        ...match.params,
        tenantId: input.tenantId,
        windowStart: input.window.startMs,
        windowEnd: input.window.endMs,
        ...(input.groupBy.kind === "attribute" ? { groupKey: input.groupBy.key } : {}),
      },
    });
    return result.rows.map((row) => ({
      dayStartMs: Number(row.bucketMs),
      value: row.groupKey,
      spentUsd: row.spendUsdStr,
    }));
  }

  async countAttributedTracesByValue(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    valueKey: string;
    values: readonly string[];
    sinceMs: number;
  }): Promise<{ value: string; count: number }[]> {
    if (input.values.length === 0) return [];
    const match = matchClause(input.matches);
    const result = await this.#clickhouse.query<{ sourceId: string; c: Numeric }>({
      tenantId: input.tenantId,
      table: "trace_summaries",
      sql: `
        SELECT ts.Attributes[{valueKey:String}] AS sourceId, toString(count()) AS c
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt >= fromUnixTimestamp64Milli({since:UInt64})
          ${match.sql}
          AND ts.Attributes[{valueKey:String}] IN ({values:Array(String)})
          AND ${latestVersion(`TenantId = {tenantId:String}
                AND OccurredAt >= fromUnixTimestamp64Milli({since:UInt64})`)}
        GROUP BY sourceId
      `,
      params: {
        ...match.params,
        tenantId: input.tenantId,
        since: input.sinceMs,
        valueKey: input.valueKey,
        values: input.values,
      },
    });
    return result.rows.map((row) => ({ value: row.sourceId, count: Number(row.c) }));
  }

  async findAttributedTracesBefore(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    attributeKeys: readonly string[];
    beforeMs: number;
    limit: number;
  }): Promise<TraceAttributedTraceDetail[]> {
    const match = matchClause(input.matches);
    const attributeColumns = input.attributeKeys
      .map((_, index) => `ts.Attributes[{attributeKey${index}:String}] AS attribute${index},`)
      .join("\n          ");
    const attributeParams = Object.fromEntries(
      input.attributeKeys.map((key, index) => [`attributeKey${index}`, key]),
    );
    const result = await this.#clickhouse.query<
      Record<string, string> & {
        eventId: string;
        target: string | null;
        costUsd: number;
        tokensInput: Numeric;
        tokensOutput: Numeric;
        occurredMs: Numeric;
        createdMs: Numeric;
      }
    >({
      tenantId: input.tenantId,
      table: "trace_summaries",
      sql: `
        SELECT
          ts.TraceId AS eventId,
          ${attributeColumns}
          arrayElement(ts.Models, 1) AS target,
          coalesce(ts.TotalCost, 0) AS costUsd,
          coalesce(ts.TotalPromptTokenCount, 0) AS tokensInput,
          coalesce(ts.TotalCompletionTokenCount, 0) AS tokensOutput,
          toString(toUnixTimestamp64Milli(ts.OccurredAt)) AS occurredMs,
          toString(toUnixTimestamp64Milli(ts.CreatedAt)) AS createdMs
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt < fromUnixTimestamp64Milli({beforeMs:UInt64})
          ${match.sql}
          AND ${latestVersion("TenantId = {tenantId:String}")}
        ORDER BY ts.OccurredAt DESC, ts.TraceId DESC
        LIMIT {limit:UInt32}
      `,
      params: {
        ...match.params,
        ...attributeParams,
        tenantId: input.tenantId,
        beforeMs: input.beforeMs,
        limit: input.limit,
      },
    });
    return result.rows.map((row) => ({
      traceId: row.eventId,
      attributes: Object.fromEntries(
        input.attributeKeys.map((key, index) => [key, row[`attribute${index}`] ?? ""]),
      ),
      firstModel: row.target ?? "",
      costUsd: Number(row.costUsd ?? 0),
      promptTokens: Number(row.tokensInput ?? 0),
      completionTokens: Number(row.tokensOutput ?? 0),
      occurredAtMs: Number(row.occurredMs),
      createdAtMs: Number(row.createdMs),
    }));
  }

  async getAttributedTraceRecency(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    countSinceMs: readonly number[];
  }): Promise<TraceAttributedRecency> {
    if (input.countSinceMs.length === 0) return { counts: [], lastOccurredAtMs: 0 };
    const match = matchClause(input.matches);
    const lastMatch = match.sql.replaceAll("ts.Attributes", "Attributes");
    const countColumns = input.countSinceMs
      .map(
        (_, index) =>
          `toString(countIf(ts.OccurredAt >= fromUnixTimestamp64Milli({since${index}:UInt64}))) AS c${index},`,
      )
      .join("\n          ");
    const sinceParams = Object.fromEntries(
      input.countSinceMs.map((sinceMs, index) => [`since${index}`, sinceMs]),
    );
    const result = await this.#clickhouse.query<Record<string, Numeric>>({
      tenantId: input.tenantId,
      table: "trace_summaries",
      sql: `
        SELECT
          ${countColumns}
          (SELECT toString(toUnixTimestamp64Milli(max(OccurredAt)))
           FROM trace_summaries
           WHERE TenantId = {tenantId:String} ${lastMatch}) AS lastMs
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt >= fromUnixTimestamp64Milli({earliest:UInt64})
          ${match.sql}
          AND ${latestVersion(`TenantId = {tenantId:String}
                AND OccurredAt >= fromUnixTimestamp64Milli({earliest:UInt64})`)}
      `,
      params: {
        ...match.params,
        ...sinceParams,
        tenantId: input.tenantId,
        earliest: Math.min(...input.countSinceMs),
      },
    });
    const row = result.rows[0];
    return {
      counts: input.countSinceMs.map((_, index) => Number(row?.[`c${index}`] ?? 0)),
      lastOccurredAtMs: row?.lastMs ? Number(row.lastMs) : 0,
    };
  }
}
