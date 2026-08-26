import type { SpanTreeCursor } from "@langwatch/trace-contract";
import { EventUtils } from "@langwatch/eventing";

import type { TraceClickHousePort } from "../../ports/clickhouse.port";
import {
  TraceRepository,
  type TraceSpanPage,
  type TraceSpanSummaryRecord,
} from "../../ports/trace.port";

const STORED_SPANS_TABLE = "stored_spans";
const DEFAULT_PARTITION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const RESOLVER_RECENT_WINDOW_MS = 35 * 24 * 60 * 60 * 1000;
const MAX_LIGHT_SPAN_READ_ROWS = 10_000;

type SpanSummaryRow = {
  SpanId: string;
  ParentSpanId: string | null;
  SpanName: string;
  SpanType: string;
  ToolName: string;
  Model: string;
  ResponseModel: string;
  Cost: string;
  InputTokens: string;
  OutputTokens: string;
  CacheReadTokens: string;
  CacheCreationTokens: string;
  CacheCreation1hTokens: string;
  InputChars: string;
  AudioSeconds: string;
  InputAudioTokens: string;
  OutputAudioTokens: string;
  CustomInputRate: string;
  CustomOutputRate: string;
  CustomCacheReadRate: string;
  CustomCacheCreationRate: string;
  CustomCacheCreation1hRate: string;
  LwSpanCost: string;
  StartTimeMs: string | number;
  DurationMs: string | number;
  UpdatedAtMs: string | number;
  StatusCode: number | string | null;
};

const numberOrNull = (value: string | number | null | undefined): number | null => {
  if (value === null || value === void 0 || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const mapStatus = (value: number | string | null): "ok" | "error" | "unset" => {
  if (value === null) {
    return "unset";
  }

  if (Number(value) === 2) {
    return "error";
  }

  return Number(value) === 1 ? "ok" : "unset";
};

const mapSummary = (row: SpanSummaryRow) => {
  const explicitCost = numberOrNull(row.Cost);
  const cost = explicitCost !== null && explicitCost > 0 ? explicitCost : null;

  return {
    spanId: row.SpanId,
    parentSpanId: row.ParentSpanId,
    name: row.SpanName,
    type: row.SpanType || null,
    startTimeMs: Number(row.StartTimeMs),
    endTimeMs: Number(row.StartTimeMs) + Number(row.DurationMs),
    durationMs: Number(row.DurationMs),
    status: mapStatus(row.StatusCode),
    model: row.Model || null,
    toolName: row.ToolName || null,
    cost,
    inputTokens: numberOrNull(row.InputTokens),
    outputTokens: numberOrNull(row.OutputTokens),
    cacheReadTokens: numberOrNull(row.CacheReadTokens),
    cacheCreationTokens: numberOrNull(row.CacheCreationTokens),
    updatedAtMs: Number(row.UpdatedAtMs),
    costInput: {
      attrs: {
        "gen_ai.response.model": row.ResponseModel || void 0,
        "gen_ai.request.model": row.Model || void 0,
        "gen_ai.usage.cache_read.input_tokens": row.CacheReadTokens || void 0,
        "gen_ai.usage.cache_creation.input_tokens": row.CacheCreationTokens || void 0,
        "gen_ai.usage.cache_creation_1h.input_tokens":
          row.CacheCreation1hTokens || void 0,
        "gen_ai.usage.input_chars": row.InputChars || void 0,
        "gen_ai.usage.audio_seconds": row.AudioSeconds || void 0,
        "gen_ai.usage.input_audio_tokens": row.InputAudioTokens || void 0,
        "gen_ai.usage.output_audio_tokens": row.OutputAudioTokens || void 0,
        "langwatch.model.inputCostPerToken": row.CustomInputRate || void 0,
        "langwatch.model.outputCostPerToken": row.CustomOutputRate || void 0,
        "langwatch.model.cacheReadCostPerToken": row.CustomCacheReadRate || void 0,
        "langwatch.model.cacheCreationCostPerToken":
          row.CustomCacheCreationRate || void 0,
        "langwatch.model.cacheCreation1hCostPerToken":
          row.CustomCacheCreation1hRate || void 0,
        "langwatch.span.cost": row.LwSpanCost || void 0,
      },
      model: row.ResponseModel || row.Model || void 0,
      promptTokens: numberOrNull(row.InputTokens),
      completionTokens: numberOrNull(row.OutputTokens),
    },
  };
};

const summarySelect = `
  SpanId,
  ParentSpanId,
  SpanName,
  coalesce(nullIf(SpanAttributes['langwatch.span.type'], ''), SpanAttributes['span.type']) AS SpanType,
  coalesce(nullIf(SpanAttributes['gen_ai.tool.name'], ''), SpanAttributes['tool_name']) AS ToolName,
  SpanAttributes['gen_ai.request.model'] AS Model,
  SpanAttributes['gen_ai.response.model'] AS ResponseModel,
  SpanAttributes['gen_ai.usage.cost'] AS Cost,
  SpanAttributes['gen_ai.usage.input_tokens'] AS InputTokens,
  SpanAttributes['gen_ai.usage.output_tokens'] AS OutputTokens,
  SpanAttributes['gen_ai.usage.cache_read.input_tokens'] AS CacheReadTokens,
  SpanAttributes['gen_ai.usage.cache_creation.input_tokens'] AS CacheCreationTokens,
  SpanAttributes['gen_ai.usage.cache_creation_1h.input_tokens'] AS CacheCreation1hTokens,
  SpanAttributes['gen_ai.usage.input_chars'] AS InputChars,
  SpanAttributes['gen_ai.usage.audio_seconds'] AS AudioSeconds,
  SpanAttributes['gen_ai.usage.input_audio_tokens'] AS InputAudioTokens,
  SpanAttributes['gen_ai.usage.output_audio_tokens'] AS OutputAudioTokens,
  SpanAttributes['langwatch.model.inputCostPerToken'] AS CustomInputRate,
  SpanAttributes['langwatch.model.outputCostPerToken'] AS CustomOutputRate,
  SpanAttributes['langwatch.model.cacheReadCostPerToken'] AS CustomCacheReadRate,
  SpanAttributes['langwatch.model.cacheCreationCostPerToken'] AS CustomCacheCreationRate,
  SpanAttributes['langwatch.model.cacheCreation1hCostPerToken'] AS CustomCacheCreation1hRate,
  SpanAttributes['langwatch.span.cost'] AS LwSpanCost,
  DurationMs,
  toUnixTimestamp64Milli(StartTime) AS StartTimeMs,
  toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAtMs,
  StatusCode
`;

const dedupInTuple = (extraInnerWhere: string): string => `
  (TenantId, TraceId, SpanId, UpdatedAt) IN (
    SELECT TenantId, TraceId, SpanId, max(UpdatedAt)
    FROM ${STORED_SPANS_TABLE}
    WHERE TenantId = {tenantId:String}
      AND TraceId = {traceId:String}
      ${extraInnerWhere}
    GROUP BY TenantId, TraceId, SpanId
  )
`;

/** Concrete, tenant-scoped span-tree persistence for ClickHouse. */
export class ClickHouseTraceSpanRepository extends TraceRepository {
  private constructor(private readonly clickhouse: TraceClickHousePort) {
    super();
  }

  static create(clickhouse: TraceClickHousePort): ClickHouseTraceSpanRepository {
    return new ClickHouseTraceSpanRepository(clickhouse);
  }

  async findSummaryPage(input: {
    tenantId: string;
    traceId: string;
    limit: number;
    cursor?: SpanTreeCursor;
    occurredAtMs?: number;
  }): Promise<TraceSpanPage> {
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "ClickHouseTraceSpanRepository.findSummaryPage",
    );

    if (input.cursor) {
      return this.queryPage(input, void 0);
    }

    const occurredAtMs =
      input.occurredAtMs ??
      (await this.resolveTraceOccurredAtMs(input.tenantId, input.traceId));
    if (occurredAtMs === void 0) {
      return this.queryPage(input, void 0);
    }

    const bounded = await this.queryPage(
      input,
      occurredAtMs - DEFAULT_PARTITION_WINDOW_MS,
    );
    return bounded.rows.length > 0 ? bounded : this.queryPage(input, void 0);
  }

  async findSummarySince(input: {
    tenantId: string;
    traceId: string;
    sinceUpdatedAtMs: number;
  }): Promise<TraceSpanSummaryRecord[]> {
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "ClickHouseTraceSpanRepository.findSummarySince",
    );

    const client = await this.clickhouse.resolve(input.tenantId);
    // Deliberately unbounded by the occurred-at hint: a live trace can run
    // past any fixed window. `UpdatedAt` is not the partition key, but the
    // tenant/trace prefix remains selective and preserves the old route's
    // behaviour for in-place span updates.
    const sinceFilter =
      "AND UpdatedAt > fromUnixTimestamp64Milli({sinceUpdatedAtMs:Int64})";
    const result = await client.query({
      query: `
        SELECT ${summarySelect}
        FROM ${STORED_SPANS_TABLE}
        WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
          ${sinceFilter}
          AND ${dedupInTuple(sinceFilter)}
        ORDER BY StartTimeMs ASC
        LIMIT ${MAX_LIGHT_SPAN_READ_ROWS}
      `,
      query_params: {
        tenantId: input.tenantId,
        traceId: input.traceId,
        sinceUpdatedAtMs: input.sinceUpdatedAtMs,
      },
      format: "JSONEachRow",
    });
    return (await result.json<SpanSummaryRow>()).map(mapSummary);
  }

  private async queryPage(
    input: {
      tenantId: string;
      traceId: string;
      limit: number;
      cursor?: SpanTreeCursor;
      occurredAtMs?: number;
    },
    lowerBoundMs: number | undefined,
  ): Promise<TraceSpanPage> {
    const client = await this.clickhouse.resolve(input.tenantId);
    const cursor = input.cursor
      ? "AND StartTime >= fromUnixTimestamp64Milli({cursorStart:Int64}) AND (toUnixTimestamp64Milli(StartTime), SpanId) > ({cursorStart:Int64}, {cursorSpan:String})"
      : "";
    const timeFilter =
      lowerBoundMs !== void 0
        ? "AND StartTime >= fromUnixTimestamp64Milli({fromMs:Int64})"
        : "";
    const result = await client.query({
      query: `
        SELECT ${summarySelect}
        FROM ${STORED_SPANS_TABLE}
        WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
          ${timeFilter}
          ${cursor}
          AND ${dedupInTuple(timeFilter)}
        ORDER BY StartTimeMs ASC, SpanId ASC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: input.tenantId,
        traceId: input.traceId,
        limit: input.limit + 1,
        ...(input.cursor
          ? {
              cursorStart: Math.trunc(input.cursor.startTimeMs),
              cursorSpan: input.cursor.spanId,
            }
          : {}),
        ...(lowerBoundMs !== void 0
          ? {
              fromMs: lowerBoundMs,
            }
          : {}),
      },
      format: "JSONEachRow",
    });
    const rows = await result.json<SpanSummaryRow>();
    const mapped = rows.map(mapSummary);
    return {
      rows: mapped.slice(0, input.limit),
      hasMore: mapped.length > input.limit,
    };
  }

  private async resolveTraceOccurredAtMs(
    tenantId: string,
    traceId: string,
  ): Promise<number | undefined> {
    const recent = await this.queryTraceOccurredAtMs({
      tenantId,
      traceId,
      sinceMs: Date.now() - RESOLVER_RECENT_WINDOW_MS,
    });
    return recent ?? this.queryTraceOccurredAtMs({ tenantId, traceId });
  }

  private async queryTraceOccurredAtMs(input: {
    tenantId: string;
    traceId: string;
    sinceMs?: number;
  }): Promise<number | undefined> {
    const client = await this.clickhouse.resolve(input.tenantId);
    const windowPredicate =
      input.sinceMs === void 0
        ? ""
        : "AND OccurredAt >= fromUnixTimestamp64Milli({sinceMs:Int64})";
    const result = await client.query({
      query: `
        SELECT toUnixTimestamp64Milli(min(OccurredAt)) AS occurredAtMs
        FROM trace_summaries
        WHERE TenantId = {tenantId:String}
          AND TraceId = {traceId:String}
          ${windowPredicate}
      `,
      query_params:
        input.sinceMs === void 0
          ? { tenantId: input.tenantId, traceId: input.traceId }
          : {
              tenantId: input.tenantId,
              traceId: input.traceId,
              sinceMs: input.sinceMs,
            },
      format: "JSONEachRow",
    });
    const row = (await result.json<{ occurredAtMs: string | number | null }>())[0];
    const value = numberOrNull(row?.occurredAtMs);
    return value !== null && value > 0 ? value : void 0;
  }
}
