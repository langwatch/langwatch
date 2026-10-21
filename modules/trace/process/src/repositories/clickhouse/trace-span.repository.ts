import type { Authorization } from "@langwatch/authorization";
import {
  type AuthorizedClickHouse,
  type IdBoundOptions,
  tenantScope,
  tenantScopeWithConditions,
} from "@langwatch/clickhouse-client";
import { nowInstant } from "@langwatch/time";
import {
  evaluationTraceEventSchema,
  evaluationTraceSpanSchema,
  type EvaluationTraceEvent,
  type EvaluationTraceSpan,
  type SpanTreeCursor,
} from "@langwatch/trace-contract";
import { z } from "zod";

import { braidedOwnerOf, readsBraidedSpans } from "../../rules/braided-span-owner.rules.ts";
import {
  TraceProjectedReadRepository,
  type TraceIngestLagSample,
  type TraceSpanPage,
  type TraceSpanSummaryRecord,
} from "../trace-projected-read.repository.ts";
import { chString, chStringMap } from "./stored-span-row.mapper.ts";

const STORED_SPANS_TABLE = "stored_spans";
/** Where a tree read is bounded by the stored_spans id index (id-index plan §4). */
const STORED_SPANS_ID_BOUND = "{{idBound:stored_spans.TraceId:traceId}}";
const evaluationTraceSpansSchema = evaluationTraceSpanSchema.array();
const evaluationTraceEventsSchema = evaluationTraceEventSchema.array();
const RESOLVER_RECENT_WINDOW_MS = 35 * 24 * 60 * 60 * 1000;
const MAX_LIGHT_SPAN_READ_ROWS = 10_000;

const numeric = z.union([z.number(), z.string()]);

const spanSummaryRowSchema = z.looseObject({
  SpanId: chString,
  ParentSpanId: chString.nullable(),
  SpanName: chString,
  SpanType: chString,
  ToolName: chString,
  Model: chString,
  ResponseModel: chString,
  Cost: chString,
  InputTokens: chString,
  OutputTokens: chString,
  CacheReadTokens: chString,
  CacheCreationTokens: chString,
  CacheCreation1hTokens: chString,
  InputChars: chString,
  AudioSeconds: chString,
  InputAudioTokens: chString,
  OutputAudioTokens: chString,
  CustomInputRate: chString,
  CustomOutputRate: chString,
  CustomCacheReadRate: chString,
  CustomCacheCreationRate: chString,
  CustomCacheCreation1hRate: chString,
  LwSpanCost: chString,
  StartTimeMs: numeric,
  DurationMs: numeric,
  UpdatedAtMs: numeric,
  StatusCode: numeric.nullable(),
  TenantId: chString.optional(),
});

const spanSummaryRowsSchema = z.array(spanSummaryRowSchema);

type SpanSummaryRow = z.infer<typeof spanSummaryRowSchema>;

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

/** A braided read names each span's owner; a read without braids keeps today's statement. */
const summarySelectFor = (authorization: Authorization): string =>
  readsBraidedSpans(authorization) ? `${summarySelect},\n  TenantId` : summarySelect;

/** The dedup election under the proof's fence; the tree reads never name a tenant (ADR-177). */
// ID_BOUND_SKIP: a dedup subquery fragment; its statement carries the marker.
const fencedDedupInTuple = (extraInnerWhere: string): string => `
  (TenantId, TraceId, SpanId, UpdatedAt) IN (
    SELECT TenantId, TraceId, SpanId, max(UpdatedAt)
    FROM ${STORED_SPANS_TABLE}
    WHERE ${tenantScope("StartTime")}
      AND TraceId = {traceId:String}
      ${extraInnerWhere}
    GROUP BY TenantId, TraceId, SpanId
  )
`;

const evaluationSpanRowSchema = z.looseObject({
  SpanType: chString,
  Model: chString,
  Contexts: chString,
});

const evaluationSpanRowsSchema = z.array(evaluationSpanRowSchema);

type EvaluationSpanRow = z.infer<typeof evaluationSpanRowSchema>;

const evaluationEventRowSchema = z.looseObject({
  EventType: chString,
  Attributes: chStringMap,
});

const evaluationEventRowsSchema = z.array(evaluationEventRowSchema);

type EvaluationEventRow = z.infer<typeof evaluationEventRowSchema>;

const ingestLagRowSchema = z.looseObject({
  P95LagMs: numeric.nullable(),
  SampleCount: numeric,
});

const ingestLagRowsSchema = z.array(ingestLagRowSchema);

const occurredAtRowSchema = z.looseObject({ occurredAtMs: numeric.nullable() });

const occurredAtRowsSchema = z.array(occurredAtRowSchema);

/** An evaluation read's bound: its time first, else the stored_spans index once ready. */
function evaluationBound(input: { occurredAtMs?: number | undefined }): IdBoundOptions {
  return { occurredAtHint: input.occurredAtMs ?? null, fallback: "unbounded" };
}

/** Concrete, tenant-scoped span-tree persistence for ClickHouse. */
export class ClickHouseTraceSpanRepository extends TraceProjectedReadRepository {
  private constructor(private readonly clickhouse: AuthorizedClickHouse) {
    super();
  }

  static create(options: { clickhouse: AuthorizedClickHouse }): ClickHouseTraceSpanRepository {
    return new ClickHouseTraceSpanRepository(options.clickhouse);
  }

  async findEvaluationSpans(input: {
    authorization: Authorization;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<EvaluationTraceSpan[]> {
    const client = this.clickhouse.as(input.authorization, { reads: "traces" });
    const result = await client.query({
      query: `
        SELECT
          SpanAttributes['langwatch.span.type'] AS SpanType,
          coalesce(nullIf(SpanAttributes['gen_ai.response.model'], ''), SpanAttributes['gen_ai.request.model']) AS Model,
          SpanAttributes['langwatch.rag.contexts'] AS Contexts
        FROM ${STORED_SPANS_TABLE}
        WHERE ${tenantScope("StartTime")}
          AND TraceId = {traceId:String}
          ${STORED_SPANS_ID_BOUND}
          AND ${fencedDedupInTuple(STORED_SPANS_ID_BOUND)}
        ORDER BY StartTime ASC
        LIMIT ${MAX_LIGHT_SPAN_READ_ROWS}
      `,
      query_params: { traceId: input.traceId },
      format: "JSONEachRow",
      idBound: evaluationBound(input),
    });
    const rows = evaluationSpanRowsSchema.parse(await result.json());
    return evaluationTraceSpansSchema.parse(
      rows.map((row) => ClickHouseTraceSpanRepository.mapEvaluationSpan(row)),
    );
  }

  async findEvaluationEvents(input: {
    authorization: Authorization;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<EvaluationTraceEvent[]> {
    const client = this.clickhouse.as(input.authorization, { reads: "traces" });
    const result = await client.query({
      query: `
        SELECT event_name AS EventType, event_attrs AS Attributes
        FROM (
          SELECT TenantId, TraceId, SpanId,
            \`Events.Timestamp\` AS Events_Timestamp,
            \`Events.Name\` AS Events_Name,
            \`Events.Attributes\` AS Events_Attributes
          FROM ${STORED_SPANS_TABLE}
          WHERE ${tenantScope("StartTime")}
            AND TraceId = {traceId:String}
            ${STORED_SPANS_ID_BOUND}
            AND ${fencedDedupInTuple(STORED_SPANS_ID_BOUND)}
        )
        ARRAY JOIN
          Events_Timestamp AS event_timestamp,
          Events_Name AS event_name,
          Events_Attributes AS event_attrs
        WHERE event_name != 'exception'
        ORDER BY event_timestamp DESC
      `,
      query_params: { traceId: input.traceId },
      format: "JSONEachRow",
      idBound: evaluationBound(input),
    });
    const rows = evaluationEventRowsSchema.parse(await result.json());
    return evaluationTraceEventsSchema.parse(
      rows.map((row) => ClickHouseTraceSpanRepository.mapEvaluationEvent(row)),
    );
  }

  async findIngestLag(input: {
    authorization: Authorization;
  }): Promise<TraceIngestLagSample | null> {
    const client = this.clickhouse.as(input.authorization, { reads: "traces" });
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
          WHERE ${tenantScope("StartTime")}
            AND StartTime >= now() - INTERVAL 7 DAY
          GROUP BY TraceId
        )
        WHERE SpanLagMs >= 0
      `,
      format: "JSONEachRow",
    });
    const rows = ingestLagRowsSchema.parse(await result.json());
    const row = rows[0];
    const p95LagMs = Number(row?.P95LagMs ?? Number.NaN);
    if (!Number.isFinite(p95LagMs)) return null;

    return {
      p95LagMs,
      sampleCount: Number(row?.SampleCount ?? 0),
    };
  }

  async listSummaryPage(input: {
    authorization: Authorization;
    traceId: string;
    limit: number;
    cursor?: SpanTreeCursor;
    occurredAtMs?: number;
  }): Promise<TraceSpanPage> {
    if (input.cursor) {
      return this.queryPage(input, undefined);
    }

    // Lower bound only: a live trace can run past any upper bound a hint would set.
    return this.queryPage(input, {
      occurredAtHint: input.occurredAtMs ?? null,
      fallback: "unbounded",
      openEnded: true,
      resolveHint: () => this.resolveTraceOccurredAtMs(input.authorization, input.traceId),
    });
  }

  async findSummarySince(input: {
    authorization: Authorization;
    traceId: string;
    sinceUpdatedAtMs: number;
    occurredAtMs?: number;
  }): Promise<TraceSpanSummaryRecord[]> {
    const client = this.clickhouse.as(input.authorization, { reads: "spans" });
    // `UpdatedAt` is not the partition key, so the trace-id marker bounds the
    // read from below only: a live trace can run past any upper bound.
    const sinceFilter = "AND UpdatedAt > fromUnixTimestamp64Milli({sinceUpdatedAtMs:Int64})";
    const result = await client.query({
      query: `
        SELECT ${summarySelectFor(input.authorization)}
        FROM ${STORED_SPANS_TABLE}
        WHERE ${tenantScopeWithConditions("StartTime")} AND TraceId = {traceId:String}
          ${STORED_SPANS_ID_BOUND}
          ${sinceFilter}
          AND ${fencedDedupInTuple(`${STORED_SPANS_ID_BOUND} ${sinceFilter}`)}
        ORDER BY StartTimeMs ASC
        LIMIT ${MAX_LIGHT_SPAN_READ_ROWS}
      `,
      query_params: {
        traceId: input.traceId,
        sinceUpdatedAtMs: input.sinceUpdatedAtMs,
      },
      format: "JSONEachRow",
      idBound: {
        occurredAtHint: input.occurredAtMs ?? null,
        fallback: "unbounded",
        openEnded: true,
        resolveHint: () => this.resolveTraceOccurredAtMs(input.authorization, input.traceId),
      },
    });
    return spanSummaryRowsSchema
      .parse(await result.json())
      .map((row) => ClickHouseTraceSpanRepository.mapSummary(row, input.authorization));
  }

  private async queryPage(
    input: {
      authorization: Authorization;
      traceId: string;
      limit: number;
      cursor?: SpanTreeCursor;
      occurredAtMs?: number;
    },
    idBound: IdBoundOptions | undefined,
  ): Promise<TraceSpanPage> {
    const client = this.clickhouse.as(input.authorization, { reads: "spans" });
    const cursor = input.cursor
      ? "AND StartTime >= fromUnixTimestamp64Milli({cursorStart:Int64}) AND (toUnixTimestamp64Milli(StartTime), SpanId) > ({cursorStart:Int64}, {cursorSpan:String})"
      : "";
    // A cursor page is bounded by the cursor's own start, so it reads no index.
    const timeFilter = idBound === undefined ? "" : STORED_SPANS_ID_BOUND;
    const result = await client.query({
      // ID_BOUND_SKIP: a first page carries the marker in timeFilter; a cursor page, its cursor.
      query: `
        SELECT ${summarySelectFor(input.authorization)}
        FROM ${STORED_SPANS_TABLE}
        WHERE ${tenantScopeWithConditions("StartTime")} AND TraceId = {traceId:String}
          ${timeFilter}
          ${cursor}
          AND ${fencedDedupInTuple(timeFilter)}
        ORDER BY StartTimeMs ASC, SpanId ASC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        traceId: input.traceId,
        limit: input.limit + 1,
        ...(input.cursor
          ? {
              cursorStart: Math.trunc(input.cursor.startTimeMs),
              cursorSpan: input.cursor.spanId,
            }
          : {}),
      },
      format: "JSONEachRow",
      ...(idBound === undefined ? {} : { idBound }),
    });
    const rows = spanSummaryRowsSchema.parse(await result.json());
    const mapped = rows.map((row) =>
      ClickHouseTraceSpanRepository.mapSummary(row, input.authorization),
    );
    return {
      rows: mapped.slice(0, input.limit),
      hasMore: mapped.length > input.limit,
    };
  }

  private async resolveTraceOccurredAtMs(
    authorization: Authorization,
    traceId: string,
  ): Promise<number | undefined> {
    const recent = await this.queryTraceOccurredAtMs({
      authorization,
      traceId,
      sinceMs: nowInstant().epochMilliseconds - RESOLVER_RECENT_WINDOW_MS,
    });
    return recent ?? this.queryTraceOccurredAtMs({ authorization, traceId });
  }

  private async queryTraceOccurredAtMs(input: {
    authorization: Authorization;
    traceId: string;
    sinceMs?: number;
  }): Promise<number | undefined> {
    const client = this.clickhouse.as(input.authorization, { reads: "traces" });
    const windowPredicate =
      input.sinceMs === void 0 ? "" : "AND OccurredAt >= fromUnixTimestamp64Milli({sinceMs:Int64})";
    const result = await client.query({
      // ID_BOUND_SKIP: the not-ready hint resolver; the index path never runs it.
      query: `
        SELECT toUnixTimestamp64Milli(min(OccurredAt)) AS occurredAtMs
        FROM trace_summaries
        WHERE ${tenantScope("OccurredAt")}
          AND TraceId = {traceId:String}
          ${windowPredicate}
      `,
      query_params:
        input.sinceMs === void 0
          ? { traceId: input.traceId }
          : { traceId: input.traceId, sinceMs: input.sinceMs },
      format: "JSONEachRow",
    });
    const row = occurredAtRowsSchema.parse(await result.json())[0];
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

  private static mapSummary(row: SpanSummaryRow, authorization: Authorization) {
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
      ...braidedOwnerOf({ authorization, tenantId: row.TenantId }),
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
