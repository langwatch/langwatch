import type {
  EvaluationTraceEvent,
  EvaluationTraceReadInput,
  EvaluationTraceSpan,
  SpanTreeCursor,
} from "@langwatch/trace-contract";
import { EventUtils } from "@langwatch/eventing";

import type { TraceClickHousePort } from "../trace-clickhouse-client.repository.ts";
import {
  TracePort,
  type TraceIngestLagSample,
  type TraceSpanPage,
  type TraceSpanSummaryRecord,
} from "../trace-projected-read.repository.ts";
import { nowInstant } from "@langwatch/time";

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

type EvaluationSpanRow = {
  SpanType: string;
  Model: string;
  Contexts: string;
};

type EvaluationEventRow = {
  EventType: string;
  Attributes: Record<string, string>;
};

/** Concrete, tenant-scoped span-tree persistence for ClickHouse. */
export class ClickHouseTraceSpanRepository extends TracePort {
  private constructor(private readonly clickhouse: TraceClickHousePort) {
    super();
  }

  static create(clickhouse: TraceClickHousePort): ClickHouseTraceSpanRepository {
    return new ClickHouseTraceSpanRepository(clickhouse);
  }

  async findEvaluationSpans(input: EvaluationTraceReadInput): Promise<EvaluationTraceSpan[]> {
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "ClickHouseTraceSpanRepository.findEvaluationSpans",
    );
    const client = await this.clickhouse.resolve(input.tenantId);
    const window =
      input.occurredAtMs === void 0
        ? ""
        : "AND StartTime BETWEEN fromUnixTimestamp64Milli({fromMs:Int64}) AND fromUnixTimestamp64Milli({toMs:Int64})";
    const result = await client.query<EvaluationSpanRow>({
      query: `
        SELECT
          SpanAttributes['langwatch.span.type'] AS SpanType,
          coalesce(nullIf(SpanAttributes['gen_ai.response.model'], ''), SpanAttributes['gen_ai.request.model']) AS Model,
          SpanAttributes['langwatch.rag.contexts'] AS Contexts
        FROM ${STORED_SPANS_TABLE}
        WHERE TenantId = {tenantId:String}
          AND TraceId = {traceId:String}
          ${window}
          AND ${dedupInTuple(window)}
        ORDER BY StartTime ASC
        LIMIT ${MAX_LIGHT_SPAN_READ_ROWS}
      `,
      query_params: {
        tenantId: input.tenantId,
        traceId: input.traceId,
        ...(input.occurredAtMs === void 0
          ? {}
          : {
              fromMs: input.occurredAtMs - DEFAULT_PARTITION_WINDOW_MS,
              toMs: input.occurredAtMs + DEFAULT_PARTITION_WINDOW_MS,
            }),
      },
      format: "JSONEachRow",
    });
    const rows = await result.json<EvaluationSpanRow>();
    if (rows.length === 0 && input.occurredAtMs !== void 0) {
      return this.findEvaluationSpans({
        tenantId: input.tenantId,
        traceId: input.traceId,
      });
    }
    return rows.map((row) => ClickHouseTraceSpanRepository.mapEvaluationSpan(row));
  }

  async findEvaluationEvents(input: EvaluationTraceReadInput): Promise<EvaluationTraceEvent[]> {
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "ClickHouseTraceSpanRepository.findEvaluationEvents",
    );
    const client = await this.clickhouse.resolve(input.tenantId);
    const window =
      input.occurredAtMs === void 0
        ? ""
        : "AND StartTime BETWEEN fromUnixTimestamp64Milli({fromMs:Int64}) AND fromUnixTimestamp64Milli({toMs:Int64})";
    const result = await client.query<EvaluationEventRow>({
      query: `
        SELECT event_name AS EventType, event_attrs AS Attributes
        FROM (
          SELECT TenantId, TraceId, SpanId,
            \`Events.Timestamp\` AS Events_Timestamp,
            \`Events.Name\` AS Events_Name,
            \`Events.Attributes\` AS Events_Attributes
          FROM ${STORED_SPANS_TABLE}
          WHERE TenantId = {tenantId:String}
            AND TraceId = {traceId:String}
            ${window}
            AND ${dedupInTuple(window)}
        )
        ARRAY JOIN
          Events_Timestamp AS event_timestamp,
          Events_Name AS event_name,
          Events_Attributes AS event_attrs
        WHERE event_name != 'exception'
        ORDER BY event_timestamp DESC
      `,
      query_params: {
        tenantId: input.tenantId,
        traceId: input.traceId,
        ...(input.occurredAtMs === void 0
          ? {}
          : {
              fromMs: input.occurredAtMs - DEFAULT_PARTITION_WINDOW_MS,
              toMs: input.occurredAtMs + DEFAULT_PARTITION_WINDOW_MS,
            }),
      },
      format: "JSONEachRow",
    });
    const rows = await result.json<EvaluationEventRow>();
    if (rows.length === 0 && input.occurredAtMs !== void 0) {
      return this.findEvaluationEvents({
        tenantId: input.tenantId,
        traceId: input.traceId,
      });
    }
    return rows.map((row) => ClickHouseTraceSpanRepository.mapEvaluationEvent(row));
  }

  async tryFindIngestLag(input: { tenantId: string }): Promise<TraceIngestLagSample | null> {
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "ClickHouseTraceSpanRepository.tryFindIngestLag",
    );

    const client = await this.clickhouse.resolve(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          quantile(0.95)(SpanLagMs) AS P95LagMs,
          count() AS SampleCount
        FROM (
          SELECT
            TraceId,
            dateDiff('millisecond', max(EndTime), max(CreatedAt)) AS SpanLagMs
          FROM stored_spans
          WHERE TenantId = {tenantId:String}
            AND StartTime >= now() - INTERVAL 7 DAY
          GROUP BY TraceId
        )
        WHERE SpanLagMs >= 0
      `,
      query_params: { tenantId: input.tenantId },
      format: "JSONEachRow",
    });
    const rows = await result.json<{
      P95LagMs: number | null;
      SampleCount: number | string;
    }>();
    const row = rows[0];
    const p95LagMs = Number(row?.P95LagMs ?? Number.NaN);
    if (!Number.isFinite(p95LagMs)) return null;

    return {
      p95LagMs,
      sampleCount: Number(row?.SampleCount ?? 0),
    };
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
      input.occurredAtMs ?? (await this.resolveTraceOccurredAtMs(input.tenantId, input.traceId));
    if (occurredAtMs === void 0) {
      return this.queryPage(input, void 0);
    }

    const bounded = await this.queryPage(input, occurredAtMs - DEFAULT_PARTITION_WINDOW_MS);
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
    const sinceFilter = "AND UpdatedAt > fromUnixTimestamp64Milli({sinceUpdatedAtMs:Int64})";
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
    return (await result.json<SpanSummaryRow>()).map((row) =>
      ClickHouseTraceSpanRepository.mapSummary(row),
    );
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
      lowerBoundMs !== void 0 ? "AND StartTime >= fromUnixTimestamp64Milli({fromMs:Int64})" : "";
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
    const mapped = rows.map((row) => ClickHouseTraceSpanRepository.mapSummary(row));
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
      sinceMs: nowInstant().epochMilliseconds - RESOLVER_RECENT_WINDOW_MS,
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
      input.sinceMs === void 0 ? "" : "AND OccurredAt >= fromUnixTimestamp64Milli({sinceMs:Int64})";
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
    const value = ClickHouseTraceSpanRepository.numberOrNull(row?.occurredAtMs);
    return value !== null && value > 0 ? value : void 0;
  }

  private static numberOrNull(value: string | number | null | undefined): number | null {
    if (value === null || value === void 0 || value === "") {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private static mapStatus(value: number | string | null): "ok" | "error" | "unset" {
    if (value === null) {
      return "unset";
    }

    if (Number(value) === 2) {
      return "error";
    }

    return Number(value) === 1 ? "ok" : "unset";
  }

  /** An empty column reads as absent, so the pricing service never sees a zero or a "". */
  private static presentOrUndefined<T>(value: T): T | undefined {
    return value || void 0;
  }

  /** Each cost attribute, and the summary-row column it is read from. */
  private static readonly COST_ATTRIBUTE_COLUMNS = [
    ["gen_ai.response.model", "ResponseModel"],
    ["gen_ai.request.model", "Model"],
    ["gen_ai.usage.cache_read.input_tokens", "CacheReadTokens"],
    ["gen_ai.usage.cache_creation.input_tokens", "CacheCreationTokens"],
    ["gen_ai.usage.cache_creation_1h.input_tokens", "CacheCreation1hTokens"],
    ["gen_ai.usage.input_chars", "InputChars"],
    ["gen_ai.usage.audio_seconds", "AudioSeconds"],
    ["gen_ai.usage.input_audio_tokens", "InputAudioTokens"],
    ["gen_ai.usage.output_audio_tokens", "OutputAudioTokens"],
    ["langwatch.model.inputCostPerToken", "CustomInputRate"],
    ["langwatch.model.outputCostPerToken", "CustomOutputRate"],
    ["langwatch.model.cacheReadCostPerToken", "CustomCacheReadRate"],
    ["langwatch.model.cacheCreationCostPerToken", "CustomCacheCreationRate"],
    ["langwatch.model.cacheCreation1hCostPerToken", "CustomCacheCreation1hRate"],
    ["langwatch.span.cost", "LwSpanCost"],
  ] as const satisfies readonly (readonly [string, keyof SpanSummaryRow])[];

  /** The cost-model inputs one summary row carries, in the shape the pricing service reads. */
  private static costInputOf(row: SpanSummaryRow) {
    const attrs: Record<string, unknown> = {};
    for (const [attribute, column] of ClickHouseTraceSpanRepository.COST_ATTRIBUTE_COLUMNS) {
      attrs[attribute] = ClickHouseTraceSpanRepository.presentOrUndefined(row[column]);
    }

    return {
      attrs,
      model: ClickHouseTraceSpanRepository.presentOrUndefined(row.ResponseModel || row.Model),
      promptTokens: ClickHouseTraceSpanRepository.numberOrNull(row.InputTokens),
      completionTokens: ClickHouseTraceSpanRepository.numberOrNull(row.OutputTokens),
    };
  }

  private static mapSummary(row: SpanSummaryRow) {
    const explicitCost = ClickHouseTraceSpanRepository.numberOrNull(row.Cost);
    const cost = explicitCost !== null && explicitCost > 0 ? explicitCost : null;

    return {
      spanId: row.SpanId,
      parentSpanId: row.ParentSpanId,
      name: row.SpanName,
      type: row.SpanType || null,
      startTimeMs: Number(row.StartTimeMs),
      endTimeMs: Number(row.StartTimeMs) + Number(row.DurationMs),
      durationMs: Number(row.DurationMs),
      status: ClickHouseTraceSpanRepository.mapStatus(row.StatusCode),
      model: row.Model || null,
      toolName: row.ToolName || null,
      cost,
      inputTokens: ClickHouseTraceSpanRepository.numberOrNull(row.InputTokens),
      outputTokens: ClickHouseTraceSpanRepository.numberOrNull(row.OutputTokens),
      cacheReadTokens: ClickHouseTraceSpanRepository.numberOrNull(row.CacheReadTokens),
      cacheCreationTokens: ClickHouseTraceSpanRepository.numberOrNull(row.CacheCreationTokens),
      updatedAtMs: Number(row.UpdatedAtMs),
      costInput: ClickHouseTraceSpanRepository.costInputOf(row),
    };
  }

  private static textualContext(value: unknown): string {
    if (typeof value === "string") {
      try {
        return ClickHouseTraceSpanRepository.textualContext(JSON.parse(value));
      } catch {
        return value.trim();
      }
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => ClickHouseTraceSpanRepository.textualContext(item))
        .filter(Boolean)
        .join("\n")
        .trim();
    }

    if (typeof value === "object" && value !== null) {
      return JSON.stringify(value);
    }

    return "";
  }

  private static mapEvaluationSpan(row: EvaluationSpanRow): EvaluationTraceSpan {
    let rawContexts: unknown;

    try {
      rawContexts = JSON.parse(row.Contexts);
    } catch {
      rawContexts = [];
    }

    const ragContextTexts = Array.isArray(rawContexts)
      ? rawContexts
          .map((context) => {
            if (typeof context === "object" && context !== null) {
              const content = Object.entries(context).find(([key]) => key === "content")?.[1];
              return ClickHouseTraceSpanRepository.textualContext(content ?? context);
            }
            return ClickHouseTraceSpanRepository.textualContext(context);
          })
          .filter(Boolean)
      : [];

    return {
      type: row.SpanType || "span",
      model: row.Model || null,
      ragContextTexts,
    };
  }

  private static mapEvaluationEvent(row: EvaluationEventRow): EvaluationTraceEvent {
    const metrics: EvaluationTraceEvent["metrics"] = [];
    const details: EvaluationTraceEvent["details"] = [];

    for (const [key, value] of Object.entries(row.Attributes)) {
      const isMetricKey =
        key === "vote" ||
        key === "score" ||
        key.startsWith("metrics.") ||
        key.startsWith("event.metrics.");
      if (isMetricKey) {
        const metricKey = key.replace(/^(event\.)?metrics\./, "");
        metrics.push({ key: metricKey, value: Number(value) || 0 });
      } else {
        details.push({ key, value });
      }
    }

    return { eventType: row.EventType, metrics, details };
  }
}
