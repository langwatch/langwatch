import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import type { TraceSummaryData } from "../types";
import type {
  CategoricalFacetResult,
  FacetCountResult,
  TraceListPage,
  TraceListQuery,
  TraceListRepository,
} from "./trace-list.repository";

const TABLE_NAME = "trace_summaries" as const;

interface ClickHouseSummaryRow {
  TraceId: string;
  TenantId: string;
  Attributes: Record<string, string>;
  OccurredAt: number;
  CreatedAt: number;
  UpdatedAt: number;
  ComputedIOSchemaVersion: string;
  ComputedInput: string | null;
  ComputedOutput: string | null;
  TimeToFirstTokenMs: number | null;
  TimeToLastTokenMs: number | null;
  TotalDurationMs: number;
  TokensPerSecond: number | null;
  SpanCount: number;
  ContainsErrorStatus: number;
  ContainsOKStatus: number;
  ErrorMessage: string | null;
  Models: string[];
  TotalCost: number | null;
  TokensEstimated: boolean;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;
  OutputFromRootSpan: number;
  OutputSpanEndTimeMs: number;
  BlockedByGuardrail: number;
  RootSpanName: string | null;
  RootSpanType: string | null;
  ContainsAi: number;
  ContainsPrompt: number;
  SelectedPromptId: string | null;
  SelectedPromptSpanId: string | null;
  LastUsedPromptId: string | null;
  LastUsedPromptVersionNumber: number | null;
  LastUsedPromptVersionId: string | null;
  LastUsedPromptSpanId: string | null;
  TopicId: string | null;
  SubTopicId: string | null;
  AnnotationIds: string[];
  ScenarioRoleCosts: Record<string, number>;
  ScenarioRoleLatencies: Record<string, number>;
  ScenarioRoleSpans: Record<string, string>;
  SpanCosts: Record<string, number>;
  lastEventOccurredAt: number;
  TotalCount: number;
}

/**
 * When the client signals `live: true` (relative preset like "Last 24h"),
 * `to` is rolling — skip the upper bound so new traces always appear.
 * For absolute ranges we keep the exact bound.
 */
function isLiveUpperBound(timeRange: { to: number; live?: boolean }): boolean {
  return timeRange.live === true;
}

function buildWhereClause(
  tenantId: string,
  timeRange: { from: number; to: number; live?: boolean },
  filterWhere?: { sql: string; params: Record<string, unknown> },
): { sql: string; params: Record<string, unknown> } {
  const parts = [
    "TenantId = {tenantId:String}",
    "OccurredAt >= fromUnixTimestamp64Milli({timeFrom:Int64})",
  ];
  const params: Record<string, unknown> = {
    tenantId,
    timeFrom: timeRange.from,
  };

  if (!isLiveUpperBound(timeRange)) {
    parts.push("OccurredAt <= fromUnixTimestamp64Milli({timeTo:Int64})");
    params.timeTo = timeRange.to;
  }

  if (filterWhere) {
    parts.push(filterWhere.sql);
    Object.assign(params, filterWhere.params);
  }

  return { sql: parts.join(" AND "), params };
}

function buildWhereClauseForTable(
  tenantId: string,
  timeRange: { from: number; to: number; live?: boolean },
  timeColumn: string,
): { sql: string; params: Record<string, unknown> } {
  const parts = [
    "TenantId = {tenantId:String}",
    `${timeColumn} >= fromUnixTimestamp64Milli({timeFrom:Int64})`,
  ];
  const params: Record<string, unknown> = {
    tenantId,
    timeFrom: timeRange.from,
  };

  if (!isLiveUpperBound(timeRange)) {
    parts.push(
      `${timeColumn} <= fromUnixTimestamp64Milli({timeTo:Int64})`,
    );
    params.timeTo = timeRange.to;
  }

  return { sql: parts.join(" AND "), params };
}

export class TraceListClickHouseRepository implements TraceListRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async findAll(query: TraceListQuery): Promise<TraceListPage> {
    EventUtils.validateTenantId(
      { tenantId: query.tenantId },
      "TraceListClickHouseRepository.findAll",
    );

    const { sql: whereClause, params } = buildWhereClause(
      query.tenantId,
      query.timeRange,
      query.filterWhere,
    );

    const sortColumn = query.sort.column;
    const sortDir = query.sort.direction === "asc" ? "ASC" : "DESC";

    const client = await this.resolveClient(query.tenantId);

    // Subquery so WHERE/ORDER BY operate on raw DateTime columns —
    // aliasing DateTime to millis in the same scope shadows the column
    // and breaks the WHERE comparison.
    const result = await client.query({
      query: `
        SELECT
          TraceId,
          TenantId,
          Attributes,
          toUnixTimestamp64Milli(OccurredAt) AS OccurredAt,
          toUnixTimestamp64Milli(CreatedAt) AS CreatedAt,
          toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt,
          ComputedIOSchemaVersion,
          ComputedInput,
          ComputedOutput,
          TimeToFirstTokenMs,
          TimeToLastTokenMs,
          TotalDurationMs,
          TokensPerSecond,
          SpanCount,
          ContainsErrorStatus,
          ContainsOKStatus,
          ErrorMessage,
          Models,
          TotalCost,
          TokensEstimated,
          TotalPromptTokenCount,
          TotalCompletionTokenCount,
          OutputFromRootSpan,
          OutputSpanEndTimeMs,
          BlockedByGuardrail,
          RootSpanName,
          RootSpanType,
          ContainsAi,
          ContainsPrompt,
          SelectedPromptId,
          SelectedPromptSpanId,
          LastUsedPromptId,
          LastUsedPromptVersionNumber,
          LastUsedPromptVersionId,
          LastUsedPromptSpanId,
          TopicId,
          SubTopicId,
          AnnotationIds,
          ScenarioRoleCosts,
          ScenarioRoleLatencies,
          ScenarioRoleSpans,
          SpanCosts,
          toUnixTimestamp64Milli(lastEventOccurredAt) AS lastEventOccurredAt,
          TotalCount
        FROM (
          SELECT *, count() OVER () AS TotalCount
          FROM ${TABLE_NAME}
          WHERE ${whereClause}
            AND (TenantId, TraceId, UpdatedAt) IN (
              SELECT TenantId, TraceId, max(UpdatedAt)
              FROM ${TABLE_NAME}
              WHERE ${whereClause}
              GROUP BY TenantId, TraceId
            )
          ORDER BY ${sortColumn} ${sortDir}
          LIMIT {limit:UInt32}
          OFFSET {offset:UInt32}
        )
      `,
      query_params: {
        ...params,
        limit: query.limit,
        offset: query.offset,
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<ClickHouseSummaryRow>();
    const totalHits = rows.length > 0 ? Number(rows[0]!.TotalCount) : 0;

    return {
      rows: rows.map((row) => this.toTraceSummaryData(row)),
      totalHits,
    };
  }

  async findFacetCounts(params: {
    tenantId: string;
    timeRange: { from: number; to: number };
    facetExpression: string;
    filterWhere?: { sql: string; params: Record<string, unknown> };
  }): Promise<FacetCountResult> {
    EventUtils.validateTenantId(
      { tenantId: params.tenantId },
      "TraceListClickHouseRepository.findFacetCounts",
    );

    const { sql: whereClause, params: queryParams } = buildWhereClause(
      params.tenantId,
      params.timeRange,
      params.filterWhere,
    );

    const client = await this.resolveClient(params.tenantId);
    const result = await client.query({
      query: `
        SELECT
          ${params.facetExpression} AS facet_value,
          count() AS cnt
        FROM ${TABLE_NAME}
        WHERE ${whereClause}
          AND (TenantId, TraceId, UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE ${whereClause}
            GROUP BY TenantId, TraceId
          )
          AND ${params.facetExpression} != ''
        GROUP BY facet_value
        ORDER BY cnt DESC
        LIMIT 100
      `,
      query_params: queryParams,
      format: "JSONEachRow",
    });

    const rows = await result.json<{ facet_value: string; cnt: number }>();
    const values: Record<string, number> = {};
    for (const row of rows) {
      values[row.facet_value] = Number(row.cnt);
    }
    return { values };
  }

  async findRangeStats(params: {
    tenantId: string;
    timeRange: { from: number; to: number };
    column: string;
    filterWhere?: { sql: string; params: Record<string, unknown> };
  }): Promise<{ min: number; max: number }> {
    EventUtils.validateTenantId(
      { tenantId: params.tenantId },
      "TraceListClickHouseRepository.findRangeStats",
    );

    const { sql: whereClause, params: queryParams } = buildWhereClause(
      params.tenantId,
      params.timeRange,
      params.filterWhere,
    );

    const client = await this.resolveClient(params.tenantId);
    const result = await client.query({
      query: `
        SELECT
          min(${params.column}) AS min_val,
          max(${params.column}) AS max_val
        FROM ${TABLE_NAME}
        WHERE ${whereClause}
          AND (TenantId, TraceId, UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE ${whereClause}
            GROUP BY TenantId, TraceId
          )
      `,
      query_params: queryParams,
      format: "JSONEachRow",
    });

    const rows = await result.json<{ min_val: number; max_val: number }>();
    const row = rows[0];
    return { min: Number(row?.min_val ?? 0), max: Number(row?.max_val ?? 0) };
  }

  async findCount(params: {
    tenantId: string;
    timeRange: { from: number; to: number };
    since: number;
    filterWhere?: { sql: string; params: Record<string, unknown> };
  }): Promise<number> {
    EventUtils.validateTenantId(
      { tenantId: params.tenantId },
      "TraceListClickHouseRepository.findCount",
    );

    const { sql: whereClause, params: queryParams } = buildWhereClause(
      params.tenantId,
      params.timeRange,
      params.filterWhere,
    );

    const client = await this.resolveClient(params.tenantId);
    const result = await client.query({
      query: `
        SELECT count() AS cnt
        FROM ${TABLE_NAME}
        WHERE ${whereClause}
          AND OccurredAt > fromUnixTimestamp64Milli({since:Int64})
          AND (TenantId, TraceId, UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE ${whereClause}
              AND OccurredAt > fromUnixTimestamp64Milli({since:Int64})
            GROUP BY TenantId, TraceId
          )
      `,
      query_params: { ...queryParams, since: params.since },
      format: "JSONEachRow",
    });

    const rows = await result.json<{ cnt: number }>();
    return Number(rows[0]?.cnt ?? 0);
  }

  async findDistinctValues(params: {
    tenantId: string;
    column: string;
    prefix: string;
    limit: number;
  }): Promise<string[]> {
    EventUtils.validateTenantId(
      { tenantId: params.tenantId },
      "TraceListClickHouseRepository.findDistinctValues",
    );

    // Bound the scan to the last 30 days so prefix-match suggest doesn't
    // touch cold (S3-tier) partitions. Suggest is interactive, so we trade
    // completeness on stale historical values for sub-second responses.
    const SUGGEST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
    const fromMs = Date.now() - SUGGEST_WINDOW_MS;

    const client = await this.resolveClient(params.tenantId);
    const result = await client.query({
      query: `
        SELECT DISTINCT ${params.column} AS val
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
          AND ${params.column} LIKE {prefix:String}
          AND (TenantId, TraceId, UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
            GROUP BY TenantId, TraceId
          )
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: params.tenantId,
        fromMs,
        prefix: `${params.prefix}%`,
        limit: params.limit,
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<{ val: string }>();
    return rows.map((r) => r.val);
  }

  async findCategoricalFacet(params: {
    tenantId: string;
    timeRange: { from: number; to: number };
    table: string;
    timeColumn: string;
    facetExpression: string;
    limit: number;
    offset: number;
    prefix?: string;
  }): Promise<CategoricalFacetResult> {
    EventUtils.validateTenantId(
      { tenantId: params.tenantId },
      "TraceListClickHouseRepository.findCategoricalFacet",
    );

    const { sql: whereClause, params: queryParams } =
      buildWhereClauseForTable(
        params.tenantId,
        params.timeRange,
        params.timeColumn,
      );

    const prefixFilter = params.prefix
      ? `AND ${params.facetExpression} ILIKE concat({prefix:String}, '%')`
      : "";

    // `trace_summaries` is a ReplacingMergeTree-style projection — the same
    // logical trace can have multiple rows (different `UpdatedAt` versions)
    // until the merge runs. Without dedup, facet counts double-count any
    // re-projected trace. Other tables (evaluation_runs, stored_spans) keep
    // their own row identity per evaluation/span, so we don't dedup there.
    const needsDedup = params.table === "trace_summaries";
    const dedupFilter = needsDedup
      ? `AND (TenantId, TraceId, UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM ${params.table}
            WHERE ${whereClause}
            GROUP BY TenantId, TraceId
          )`
      : "";

    const client = await this.resolveClient(params.tenantId);
    const result = await client.query({
      query: `
        SELECT
          ${params.facetExpression} AS facet_value,
          count() AS cnt,
          count() OVER () AS total_distinct
        FROM ${params.table}
        WHERE ${whereClause}
          ${dedupFilter}
          AND ${params.facetExpression} != ''
          ${prefixFilter}
        GROUP BY facet_value
        ORDER BY cnt DESC
        LIMIT {limit:UInt32} OFFSET {offset:UInt32}
      `,
      query_params: {
        ...queryParams,
        limit: params.limit,
        offset: params.offset,
        ...(params.prefix ? { prefix: params.prefix } : {}),
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<{
      facet_value: string;
      cnt: number;
      total_distinct: number;
    }>();

    return {
      values: rows.map((r) => ({
        value: r.facet_value,
        count: Number(r.cnt),
      })),
      totalDistinct: rows.length > 0 ? Number(rows[0]!.total_distinct) : 0,
    };
  }

  async findCategoricalFacetRaw(params: {
    tenantId: string;
    query: { sql: string; params: Record<string, unknown> };
  }): Promise<CategoricalFacetResult> {
    EventUtils.validateTenantId(
      { tenantId: params.tenantId },
      "TraceListClickHouseRepository.findCategoricalFacetRaw",
    );

    const client = await this.resolveClient(params.tenantId);
    const result = await client.query({
      query: params.query.sql,
      query_params: params.query.params,
      format: "JSONEachRow",
    });

    const rows = await result.json<{
      facet_value: string;
      facet_label?: string;
      cnt: number;
      total_distinct: number;
    }>();

    return {
      values: rows.map((r) => ({
        value: r.facet_value,
        ...(r.facet_label ? { label: r.facet_label } : {}),
        count: Number(r.cnt),
      })),
      totalDistinct: rows.length > 0 ? Number(rows[0]!.total_distinct) : 0,
    };
  }

  async findRangeStatsForTable(params: {
    tenantId: string;
    timeRange: { from: number; to: number };
    table: string;
    timeColumn: string;
    column: string;
  }): Promise<{ min: number; max: number }> {
    EventUtils.validateTenantId(
      { tenantId: params.tenantId },
      "TraceListClickHouseRepository.findRangeStatsForTable",
    );

    const { sql: whereClause, params: queryParams } =
      buildWhereClauseForTable(
        params.tenantId,
        params.timeRange,
        params.timeColumn,
      );

    const client = await this.resolveClient(params.tenantId);
    const result = await client.query({
      query: `
        SELECT
          min(${params.column}) AS min_val,
          max(${params.column}) AS max_val
        FROM ${params.table}
        WHERE ${whereClause}
      `,
      query_params: queryParams,
      format: "JSONEachRow",
    });

    const rows = await result.json<{ min_val: number; max_val: number }>();
    const row = rows[0];
    return { min: Number(row?.min_val ?? 0), max: Number(row?.max_val ?? 0) };
  }

  async findAttributeValues(params: {
    tenantId: string;
    timeRange: { from: number; to: number };
    attributeKey: string;
    prefix?: string;
    limit: number;
    offset: number;
  }): Promise<CategoricalFacetResult> {
    EventUtils.validateTenantId(
      { tenantId: params.tenantId },
      "TraceListClickHouseRepository.findAttributeValues",
    );

    // Attribute values are typically low-cardinality (sdk.version, sdk.language, …
    // a handful of values). We don't need exact counts to populate the picker —
    // we just need the distinct values, and we need them fast.
    //
    // Strategy: scan a bounded prefix of rows that have the key set and pull the
    // distinct values out of that sample. For low-cardinality keys the sample
    // surfaces every value in milliseconds; for high-cardinality keys the user
    // narrows via the search input and we re-query with a prefix.
    //
    // Counts come back as 0 — the UI hides them for attribute facets.
    const ATTR_VALUE_SAMPLE_ROWS = 50_000;

    const innerPrefix = params.prefix
      ? "AND lower(Attributes[{attrKey:String}]) LIKE concat({prefix:String}, '%')"
      : "";

    const sql = `
      SELECT
        facet_value,
        0 AS cnt,
        0 AS total_distinct
      FROM (
        SELECT DISTINCT Attributes[{attrKey:String}] AS facet_value
        FROM ${TABLE_NAME}
        PREWHERE TenantId = {tenantId:String}
          AND OccurredAt >= fromUnixTimestamp64Milli({timeFrom:Int64})
          AND OccurredAt <= fromUnixTimestamp64Milli({timeTo:Int64})
          AND mapContains(Attributes, {attrKey:String})
        WHERE Attributes[{attrKey:String}] != ''
          ${innerPrefix}
        LIMIT {sampleRows:UInt32}
        SETTINGS
          max_execution_time = 3,
          timeout_overflow_mode = 'break',
          max_threads = 8
      )
      ORDER BY facet_value
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `;

    const client = await this.resolveClient(params.tenantId);
    const result = await client.query({
      query: sql,
      query_params: {
        tenantId: params.tenantId,
        timeFrom: params.timeRange.from,
        timeTo: params.timeRange.to,
        attrKey: params.attributeKey,
        limit: params.limit,
        offset: params.offset,
        sampleRows: ATTR_VALUE_SAMPLE_ROWS,
        ...(params.prefix ? { prefix: params.prefix } : {}),
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<{
      facet_value: string;
      cnt: number;
      total_distinct: number;
    }>();

    return {
      values: rows.map((r) => ({
        value: r.facet_value,
        count: Number(r.cnt),
      })),
      totalDistinct: rows.length > 0 ? Number(rows[0]!.total_distinct) : 0,
    };
  }

  private toTraceSummaryData(row: ClickHouseSummaryRow): TraceSummaryData {
    return {
      traceId: row.TraceId,
      spanCount: row.SpanCount,
      totalDurationMs: Number(row.TotalDurationMs),
      computedIOSchemaVersion: row.ComputedIOSchemaVersion,
      computedInput: row.ComputedInput,
      computedOutput: row.ComputedOutput,
      timeToFirstTokenMs: row.TimeToFirstTokenMs,
      timeToLastTokenMs: row.TimeToLastTokenMs,
      tokensPerSecond: row.TokensPerSecond,
      containsErrorStatus: !!row.ContainsErrorStatus,
      containsOKStatus: !!row.ContainsOKStatus,
      errorMessage: row.ErrorMessage,
      models: row.Models,
      totalCost: row.TotalCost,
      tokensEstimated: !!row.TokensEstimated,
      totalPromptTokenCount: row.TotalPromptTokenCount,
      totalCompletionTokenCount: row.TotalCompletionTokenCount,
      outputFromRootSpan: !!row.OutputFromRootSpan,
      outputSpanEndTimeMs: Number(row.OutputSpanEndTimeMs),
      blockedByGuardrail: !!row.BlockedByGuardrail,
      rootSpanName: row.RootSpanName,
      rootSpanType: row.RootSpanType,
      containsAi: !!row.ContainsAi,
      containsPrompt: !!row.ContainsPrompt,
      selectedPromptId: row.SelectedPromptId,
      selectedPromptSpanId: row.SelectedPromptSpanId,
      selectedPromptStartTimeMs: null,
      lastUsedPromptId: row.LastUsedPromptId,
      lastUsedPromptVersionNumber: row.LastUsedPromptVersionNumber,
      lastUsedPromptVersionId: row.LastUsedPromptVersionId,
      lastUsedPromptSpanId: row.LastUsedPromptSpanId,
      lastUsedPromptStartTimeMs: null,
      topicId: row.TopicId,
      subTopicId: row.SubTopicId,
      annotationIds: row.AnnotationIds ?? [],
      attributes: row.Attributes ?? {},
      scenarioRoleCosts: row.ScenarioRoleCosts ?? {},
      scenarioRoleLatencies: row.ScenarioRoleLatencies ?? {},
      scenarioRoleSpans: row.ScenarioRoleSpans ?? {},
      spanCosts: row.SpanCosts ?? {},
      occurredAt: Number(row.OccurredAt),
      createdAt: Number(row.CreatedAt),
      updatedAt: Number(row.UpdatedAt),
      lastEventOccurredAt: Number(row.lastEventOccurredAt ?? 0),
    };
  }
}
