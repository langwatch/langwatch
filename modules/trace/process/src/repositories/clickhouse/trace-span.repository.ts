import { type Authorization, ownProjectIdReadBy } from "@langwatch/authorization";
import type { ClickHouseQueryClient, IdBoundOptions } from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  fn,
  param,
  tenantScope,
  type Condition,
  type ConditionOps,
  type Expression,
} from "@langwatch/clickhouse-client/builder";
import { nowInstant } from "@langwatch/time";
import {
  evaluationTraceEventSchema,
  evaluationTraceSpanSchema,
  type EvaluationTraceEvent,
  type EvaluationTraceSpan,
  type SpanTreeCursor,
} from "@langwatch/trace-contract";
import { z } from "zod";

import {
  braidedOwnerOf,
  readsBraidedSpans,
} from "../../features/braid/rules/braided-span-owner.rules.ts";
import {
  TraceProjectedReadRepository,
  type TraceIngestLagSample,
  type TraceSpanPage,
  type TraceSpanSummaryRecord,
} from "../trace-projected-read.repository.ts";
import { storedSpans as spans } from "./clickhouse.stored-spans.table.ts";
import { traceSummaries } from "./clickhouse.trace-summaries.table.ts";
import { chString, chStringMap } from "./stored-span-row.mapper.ts";

const evaluationTraceSpansSchema = evaluationTraceSpanSchema.array();
const evaluationTraceEventsSchema = evaluationTraceEventSchema.array();
const RESOLVER_RECENT_WINDOW_MS = 35 * 24 * 60 * 60 * 1000;
const MAX_LIGHT_SPAN_READ_ROWS = 10_000;
const INGEST_LAG_WINDOW_SECONDS = 7 * 24 * 60 * 60;

const numeric = z.union([z.number(), z.string()]);

/** `UsageCost` is the span's `gen_ai.usage.cost` attribute; `Cost` is a stored column's name. */
const spanSummaryRowSchema = z.looseObject({
  SpanId: chString,
  ParentSpanId: chString.nullable(),
  SpanName: chString,
  SpanType: chString,
  ToolName: chString,
  Model: chString,
  ResponseModel: chString,
  UsageCost: chString,
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

/** The braid feature's own statement still reads these columns as text (features/braid). */
const summarySelect = `
  SpanId,
  ParentSpanId,
  SpanName,
  coalesce(nullIf(SpanAttributes['langwatch.span.type'], ''), SpanAttributes['span.type']) AS SpanType,
  coalesce(nullIf(SpanAttributes['gen_ai.tool.name'], ''), SpanAttributes['tool_name']) AS ToolName,
  SpanAttributes['gen_ai.request.model'] AS Model,
  SpanAttributes['gen_ai.response.model'] AS ResponseModel,
  SpanAttributes['gen_ai.usage.cost'] AS UsageCost,
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

const attribute = (key: string) => fn.mapGet(spans.SpanAttributes, key);
/** The first attribute when it is not empty, else the second. */
const attributeOr = (key: string, fallback: string) =>
  fn.coalesce(fn.nullIf(attribute(key), ""), attribute(fallback));

/** The tree's summary columns, as `summarySelect` reads them. */
const SUMMARY_SELECTION = {
  SpanId: spans.SpanId,
  ParentSpanId: spans.ParentSpanId,
  SpanName: spans.SpanName,
  SpanType: attributeOr("langwatch.span.type", "span.type"),
  ToolName: attributeOr("gen_ai.tool.name", "tool_name"),
  Model: attribute("gen_ai.request.model"),
  ResponseModel: attribute("gen_ai.response.model"),
  UsageCost: attribute("gen_ai.usage.cost"),
  InputTokens: attribute("gen_ai.usage.input_tokens"),
  OutputTokens: attribute("gen_ai.usage.output_tokens"),
  CacheReadTokens: attribute("gen_ai.usage.cache_read.input_tokens"),
  CacheCreationTokens: attribute("gen_ai.usage.cache_creation.input_tokens"),
  CacheCreation1hTokens: attribute("gen_ai.usage.cache_creation_1h.input_tokens"),
  InputChars: attribute("gen_ai.usage.input_chars"),
  AudioSeconds: attribute("gen_ai.usage.audio_seconds"),
  InputAudioTokens: attribute("gen_ai.usage.input_audio_tokens"),
  OutputAudioTokens: attribute("gen_ai.usage.output_audio_tokens"),
  CustomInputRate: attribute("langwatch.model.inputCostPerToken"),
  CustomOutputRate: attribute("langwatch.model.outputCostPerToken"),
  CustomCacheReadRate: attribute("langwatch.model.cacheReadCostPerToken"),
  CustomCacheCreationRate: attribute("langwatch.model.cacheCreationCostPerToken"),
  CustomCacheCreation1hRate: attribute("langwatch.model.cacheCreation1hCostPerToken"),
  LwSpanCost: attribute("langwatch.span.cost"),
  DurationMs: spans.DurationMs,
  StartTimeMs: fn.toUnixTimestamp64Milli(spans.StartTime),
  UpdatedAtMs: fn.toUnixTimestamp64Milli(spans.UpdatedAt),
  StatusCode: spans.StatusCode,
};

/** A braided read names each span's owner; a read without braids keeps today's columns. */
const summarySelectionFor = (authorization: Authorization) =>
  readsBraidedSpans(authorization)
    ? { ...SUMMARY_SELECTION, TenantId: spans.TenantId }
    : SUMMARY_SELECTION;

/** Every tree read is fenced by the proof; it never names a tenant itself (ADR-177). */
const fenced = (authorization: Authorization, reads: "traces" | "spans") =>
  tenantScope.fromProof({ authorization, reads });

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
  private constructor(private readonly clickhouse: Pick<ClickHouseQueryClient, "read">) {
    super();
  }

  static create(options: {
    clickhouse: Pick<ClickHouseQueryClient, "read">;
  }): ClickHouseTraceSpanRepository {
    return new ClickHouseTraceSpanRepository(options.clickhouse);
  }

  async findEvaluationSpans(input: {
    authorization: Authorization;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<EvaluationTraceSpan[]> {
    const statement = clickhouseRead({ scope: fenced(input.authorization, "traces") })
      .from(spans)
      .withinWindows()
      .select({
        SpanType: attribute("langwatch.span.type"),
        Model: attributeOr("gen_ai.response.model", "gen_ai.request.model"),
        Contexts: attribute("langwatch.rag.contexts"),
      })
      .where(({ idBound }) => idBound(spans.TraceId, input.traceId))
      .latestVersion()
      .orderBy(spans.StartTime, "ASC")
      .limit(MAX_LIGHT_SPAN_READ_ROWS)
      .build();
    const result = await this.clickhouse.read({
      statement,
      table: spans.$table.name,
      idBound: evaluationBound(input),
    });
    const rows = evaluationSpanRowsSchema.parse(result.rows);
    return evaluationTraceSpansSchema.parse(
      rows.map((row) => ClickHouseTraceSpanRepository.mapEvaluationSpan(row)),
    );
  }

  async findEvaluationEvents(input: {
    authorization: Authorization;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<EvaluationTraceEvent[]> {
    const scope = fenced(input.authorization, "traces");
    // Each span's latest version, then one row per event: flattening stays outside the election.
    const latest = clickhouseRead({ scope })
      .from(spans)
      .withinWindows()
      .select({
        SpanEvents: fn.arrayZip(
          spans["Events.Timestamp"],
          spans["Events.Name"],
          spans["Events.Attributes"],
        ),
      })
      .where(({ idBound }) => idBound(spans.TraceId, input.traceId))
      .latestVersion()
      .as("latest");
    const events = clickhouseRead({ scope })
      .from(latest)
      .select({ Event: fn.arrayJoin(latest.SpanEvents) })
      .as("events");
    const statement = clickhouseRead({ scope })
      .from(events)
      .select({
        EventType: fn.tupleElement(events.Event, "1"),
        Attributes: fn.tupleElement(events.Event, "2"),
      })
      .where(({ ne }) => ne(fn.tupleElement(events.Event, "1"), param.string("exception")))
      .orderBy(fn.tupleElement(events.Event, "0"), "DESC")
      .build();
    const result = await this.clickhouse.read({
      statement,
      table: spans.$table.name,
      idBound: evaluationBound(input),
    });
    const rows = evaluationEventRowsSchema.parse(result.rows);
    return evaluationTraceEventsSchema.parse(
      rows.map((row) => ClickHouseTraceSpanRepository.mapEvaluationEvent(row)),
    );
  }

  async findIngestLag(input: {
    authorization: Authorization;
  }): Promise<TraceIngestLagSample | null> {
    const scope = fenced(input.authorization, "traces");
    const lags = clickhouseRead({ scope })
      .from(spans)
      .withinWindows()
      .select({
        TraceId: spans.TraceId,
        SpanLagMs: fn.dateDiff("millisecond", fn.max(spans.EndTime), fn.max(spans.CreatedAt)),
      })
      .where(({ gte }) =>
        gte(spans.StartTime, fn.minus(fn.now(), param.int64(INGEST_LAG_WINDOW_SECONDS))),
      )
      .groupBy(spans.TraceId)
      .as("lags");
    const statement = clickhouseRead({ scope })
      .from(lags)
      .select({ P95LagMs: fn.quantile(0.95, lags.SpanLagMs), SampleCount: fn.count() })
      .where(({ gte }) => gte(lags.SpanLagMs, 0))
      .build();
    const result = await this.clickhouse.read({ statement, table: spans.$table.name });
    const rows = ingestLagRowsSchema.parse(result.rows);
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
    // `UpdatedAt` is not the partition key, so the trace-id bound bounds the read from below
    // only: a live trace can run past any upper bound.
    // `repeat` keeps main's election; the since filter is monotone in the version, so rows match.
    const statement = clickhouseRead({ scope: fenced(input.authorization, "spans") })
      .from(spans)
      .braided({ heldTrace: { traceId: input.traceId } })
      .select(summarySelectionFor(input.authorization))
      .where(({ idBound }) => idBound(spans.TraceId, input.traceId))
      .where(({ gt }) => gt(spans.UpdatedAt, input.sinceUpdatedAtMs))
      .latestVersion({ repeat: [spans.UpdatedAt] })
      .orderBy("StartTimeMs", "ASC")
      .limit(MAX_LIGHT_SPAN_READ_ROWS)
      .build();
    const result = await this.clickhouse.read({
      statement,
      table: spans.$table.name,
      idBound: {
        occurredAtHint: input.occurredAtMs ?? null,
        fallback: "unbounded",
        openEnded: true,
        resolveHint: () => this.resolveTraceOccurredAtMs(input.authorization, input.traceId),
      },
    });
    return spanSummaryRowsSchema
      .parse(result.rows)
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
    // The row past a page may be an owner's, read before any audit: under a braid none is read,
    // and a full page offers the next one (ADR-201 §8, v1.18).
    const peeks = !readsBraidedSpans(input.authorization);
    const page = clickhouseRead({ scope: fenced(input.authorization, "spans") })
      .from(spans)
      .braided({ heldTrace: { traceId: input.traceId } })
      .select(summarySelectionFor(input.authorization))
      // A cursor page is bounded by the cursor's own start, so it reads no index.
      .where(({ eq, idBound: bound }) =>
        idBound === undefined
          ? eq(spans.TraceId, input.traceId)
          : bound(spans.TraceId, input.traceId),
      );
    const cursor = input.cursor;
    const statement = (
      cursor === undefined
        ? page
        : page.where(
            (ops) => ClickHouseTraceSpanRepository.afterCursor({ ...input, cursor, ops }),
            { inElection: false },
          )
    )
      .latestVersion()
      .orderBy("StartTimeMs", "ASC")
      .orderBy(spans.SpanId, "ASC")
      .orderBy(spans.TenantId, "ASC")
      .limit(peeks ? input.limit + 1 : input.limit)
      .build();
    const result = await this.clickhouse.read({
      statement,
      table: spans.$table.name,
      ...(idBound === undefined ? {} : { idBound }),
    });
    const rows = spanSummaryRowsSchema.parse(result.rows);
    const mapped = rows.map((row) =>
      ClickHouseTraceSpanRepository.mapSummary(row, input.authorization),
    );
    return {
      rows: mapped.slice(0, input.limit),
      hasMore: peeks ? mapped.length > input.limit : mapped.length >= input.limit,
    };
  }

  /** The spans after a page's last one; filters the elected rows only, never the election. */
  private static afterCursor({
    authorization,
    cursor,
    ops: { and, gt, gte },
  }: {
    authorization: Authorization;
    cursor: SpanTreeCursor;
    ops: Pick<ConditionOps<"stored_spans", Record<string, never>>, "and" | "gt" | "gte">;
  }): Condition<"stored_spans"> {
    const startMs = Math.trunc(cursor.startTimeMs);
    const tenant = ClickHouseTraceSpanRepository.cursorTenantOf({ authorization, cursor });
    const position =
      tenant === null
        ? gt(
            fn.tuple(fn.toUnixTimestamp64Milli(spans.StartTime), spans.SpanId),
            fn.tuple(param.int64(startMs), param.string(cursor.spanId)),
          )
        : gt(
            fn.tuple(fn.toUnixTimestamp64Milli(spans.StartTime), spans.SpanId, spans.TenantId),
            fn.tuple(param.int64(startMs), param.string(cursor.spanId), param.string(tenant)),
          );
    return and(gte(spans.StartTime, startMs), position);
  }

  /**
   * The tenant a cursor's last span sits in, so one span id held by two tenants is two positions.
   * Null when the read spans no braid or the cursor predates braids: those page as before.
   */
  private static cursorTenantOf({
    authorization,
    cursor,
  }: {
    authorization: Authorization;
    cursor: SpanTreeCursor;
  }): string | null {
    if (!readsBraidedSpans(authorization) || cursor.ownerProjectId === undefined) return null;
    return cursor.ownerProjectId ?? ownProjectIdReadBy(authorization);
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
    const sinceMs = input.sinceMs;
    const byTrace = clickhouseRead({ scope: fenced(input.authorization, "traces") })
      .from(traceSummaries)
      .withinWindows()
      .select({ occurredAtMs: fn.toUnixTimestamp64Milli(fn.min(traceSummaries.OccurredAt)) })
      .where(({ eq }) => eq(traceSummaries.TraceId, input.traceId));
    // The not-ready hint resolver: the index path never runs it, so it reads no id bound.
    const statement = (
      sinceMs === void 0
        ? byTrace
        : byTrace.where(({ gte }) => gte(traceSummaries.OccurredAt, sinceMs))
    ).build();
    const result = await this.clickhouse.read({ statement, table: traceSummaries.$table.name });
    const row = occurredAtRowsSchema.parse(result.rows)[0];
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

  /** The tree's summary columns, for a statement of the module's own reading the same nodes. */
  static readonly summarySelect: string = summarySelect;

  /** The tree's summary columns as a built selection, the owner named under a braided proof. */
  static summarySelection(
    authorization: Authorization,
  ): Record<string, Expression<unknown, typeof spans.$table.name>> {
    return summarySelectionFor(authorization);
  }

  /** Rows selected with `summarySelect`, mapped as the tree maps them. */
  static summaryRecordsOf({
    rows,
    authorization,
  }: {
    rows: unknown;
    authorization: Authorization;
  }): TraceSpanSummaryRecord[] {
    return spanSummaryRowsSchema
      .parse(rows)
      .map((row) => ClickHouseTraceSpanRepository.mapSummary(row, authorization));
  }

  private static mapSummary(row: SpanSummaryRow, authorization: Authorization) {
    const explicitCost = ClickHouseTraceSpanRepository.numberOrNull(row.UsageCost);
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
