import type { Authorization } from "@langwatch/authorization";
import {
  type AuthorizedClickHouse,
  DEFAULT_PARTITION_WINDOW_MS,
  RESOLVER_RECENT_WINDOW_MS,
  queryWindowed,
  type TenantScopedReader,
  tenantScope,
  tenantScopeKey,
  type WindowFragment,
} from "@langwatch/clickhouse-client";
import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { ATTR_KEYS } from "@langwatch/span-normalisation";
import { nowInstant } from "@langwatch/time";
import {
  type DerivedTraceEvent,
  type NormalizedAttributes,
  type NormalizedSpan,
  type ElasticSearchEvent,
  type Span,
  type SpanInsertData,
  type SpanResourceInfo,
  type SpanSummaryRow,
  type TraceEventRollup,
  listedTraceKey,
} from "@langwatch/trace-contract";

import { mapNormalizedSpansToSpans } from "../../features/legacy/rules/trace-legacy-span-mapping.rules.ts";
import { computeSpanCost } from "../../features/span/rules/trace-span-cost-matching.rules.ts";
import type { TraceClickHouseWriteResolver as ClickHouseClientResolver } from "./clickhouse.trace-member-client.repository.ts";
/**
 * The insert shape of a row whose epoch-millisecond fields are written as
 * `Date`s: the ClickHouse driver serialises a `Date` into a `DateTime64(3)`
 * literal, while the read shape keeps the numbers every caller works in.
 */
type DateWrite<V> = V extends number
  ? Date
  : V extends number | null
    ? Date | null
    : V extends number[]
      ? Date[]
      : V;

type WithDateWrites<T, K extends keyof T> = {
  [P in keyof T]: P extends K ? DateWrite<T[P]> : T[P];
};
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "@langwatch/data-retention-contract";
import { z } from "zod";

import {
  chNumber,
  chString,
  chStringMap,
  ensureStringRecord,
  fullSpanRowsSchema,
  mapChRowToNormalized,
  serializeAttributes,
} from "./stored-span-row.mapper.ts";

const logger = createLogger("langwatch:app-layer:traces:span-storage-repository");
import {
  SpanStorageRepository,
  type LangwatchSignalBucket,
  type ModelSpanSampleRow,
  type ModelUsageStatsRow,
  type NormalizedSpanByIdParams,
  type OccurredAtHint,
  type SpanLangwatchSignalsRow,
  type TraceEventRollupParams,
  LANGWATCH_SIGNAL_BUCKETS,
  MAX_DERIVATION_SPANS,
  MAX_EVENT_NAMES_PER_TRACE,
  MAX_LIGHT_SPAN_READ_ROWS,
  MAX_STORED_TRACE_SPAN_ROWS,
  type StoredTraceSpan,
} from "../span-storage.repository.ts";

const TABLE_NAME = "stored_spans" as const;

/**
 * Settings for every `stored_spans` insert.
 */
const SPAN_INSERT_SETTINGS = {
  async_insert: 1,
  wait_for_async_insert: 1,
  input_format_json_throw_on_bad_escape_sequence: 0,
} as const;

/**
 * Renders partition-pruning time predicate for stored_spans from a WindowFragment.
 */
function partitionFragment(window: WindowFragment | null): {
  sqlAnd: string;
  sqlAndInner: string;
  params: Record<string, unknown>;
} {
  if (!window) {
    return { sqlAnd: "", sqlAndInner: "", params: {} };
  }
  const predicate = window.sqlFor("StartTime");
  return { sqlAnd: predicate, sqlAndInner: predicate, params: window.params };
}

/**
 * Full-span column projection used by every reader that returns `Span[]`. Defined
 * once so a column rename in `stored_spans` lands in one place.
 */
const FULL_SPAN_SELECT = `
  SpanId,
  TraceId,
  TenantId,
  ParentSpanId,
  ParentTraceId,
  ParentIsRemote,
  Sampled,
  toUnixTimestamp64Milli(StartTime) AS StartTimeMs,
  toUnixTimestamp64Milli(EndTime) AS EndTimeMs,
  DurationMs,
  SpanName,
  SpanKind,
  ResourceAttributes,
  SpanAttributes,
  StatusCode,
  StatusMessage,
  ScopeName,
  ScopeVersion,
  Cost,
  NonBilledCost,
  arrayMap(x -> toUnixTimestamp64Milli(x), \`Events.Timestamp\`) AS Events_Timestamp,
  \`Events.Name\` AS Events_Name,
  \`Events.Attributes\` AS Events_Attributes,
  \`Links.TraceId\` AS Links_TraceId,
  \`Links.SpanId\` AS Links_SpanId,
  \`Links.Attributes\` AS Links_Attributes
`;

/**
 * {@link FULL_SPAN_SELECT} minus the `Events.*` / `Links.*` nested columns, for
 * internal derivation consumers that read scalar span/resource attributes and
 * never touch a span's events or links.
 */
const DERIVATION_SPAN_SELECT = `
  SpanId,
  TraceId,
  TenantId,
  ParentSpanId,
  ParentTraceId,
  ParentIsRemote,
  Sampled,
  toUnixTimestamp64Milli(StartTime) AS StartTimeMs,
  toUnixTimestamp64Milli(EndTime) AS EndTimeMs,
  DurationMs,
  SpanName,
  SpanKind,
  ResourceAttributes,
  SpanAttributes,
  StatusCode,
  StatusMessage,
  ScopeName,
  ScopeVersion,
  Cost,
  NonBilledCost
`;

/**
 * Per-query memory ceiling for the single-trace full-attribute reads below.
 */
const SINGLE_TRACE_READ_MAX_MEMORY_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
const SINGLE_TRACE_READ_SETTINGS = {
  // ClickHouse settings are string-typed over the wire.
  max_memory_usage: String(SINGLE_TRACE_READ_MAX_MEMORY_BYTES),
} as const;

/**
 * Settings for the single-span fetch paths (`findSpanByIds`, `getSpanEvents`).
 * Locks `query_plan_optimize_lazy_materialization=1` per-query so the LazilyRead
 * optimiser stays engaged even if a future cluster/profile config flips it off.
 */
const SINGLE_SPAN_FETCH_SETTINGS = {
  ...SINGLE_TRACE_READ_SETTINGS,
  query_plan_optimize_lazy_materialization: "1",
} as const;

/**
 * Light projection for span tree shape, avoiding heavy nested columns.
 */
const SUMMARY_SPAN_SELECT = `
  SpanId,
  ParentSpanId,
  SpanName,
  DurationMs,
  StatusCode,
  coalesce(
    nullIf(SpanAttributes['langwatch.span.type'], ''),
    SpanAttributes['span.type']
  ) AS SpanType,
  coalesce(
    nullIf(SpanAttributes['gen_ai.tool.name'], ''),
    SpanAttributes['tool_name']
  ) AS ToolName,
  SpanAttributes['request_id'] AS RequestId,
  SpanAttributes['query_source'] AS QuerySource,
  coalesce(
    nullIf(SpanAttributes['tool_use_id'], ''),
    SpanAttributes['gen_ai.tool.call.id']
  ) AS ToolUseId,
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
  SpanAttributes['gen_ai.usage.input_image_tokens'] AS InputImageTokens,
  SpanAttributes['gen_ai.usage.output_image_tokens'] AS OutputImageTokens,
  SpanAttributes['langwatch.model.inputCostPerToken'] AS CustomInputRate,
  SpanAttributes['langwatch.model.outputCostPerToken'] AS CustomOutputRate,
  SpanAttributes['langwatch.model.cacheReadCostPerToken'] AS CustomCacheReadRate,
  SpanAttributes['langwatch.model.cacheCreationCostPerToken'] AS CustomCacheCreationRate,
  SpanAttributes['langwatch.model.cacheCreation1hCostPerToken'] AS CustomCacheCreation1hRate,
  SpanAttributes['langwatch.span.cost'] AS LwSpanCost,
  toUnixTimestamp64Milli(StartTime) AS StartTimeMs,
  toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAtMs
`;

/**
 * Canonical model-name expression: response model wins over request model.
 */
const MODEL_ATTR_SELECT = `coalesce(
    nullIf(SpanAttributes['gen_ai.response.model'], ''),
    SpanAttributes['gen_ai.request.model']
  )`;

/**
 * Candidate trace pool size for model-cost sample read.
 */
const SAMPLE_CANDIDATE_TRACE_POOL = 500;

const numeric = z.union([z.number(), z.string()]);

const modelSpanSampleQueryRowSchema = z.looseObject({
  TraceId: chString,
  SpanId: chString,
  SpanName: chString,
  Model: chString,
  InputTokensRaw: chString,
  PromptTokensRaw: chString,
  OutputTokensRaw: chString,
  CompletionTokensRaw: chString,
  CacheReadTokensRaw: chString,
  CacheCreationTokensRaw: chString,
  CacheCreation1hTokensRaw: chString,
  StartTimeMs: numeric,
});

const modelSpanSampleQueryRowsSchema = z.array(modelSpanSampleQueryRowSchema);

type ModelSpanSampleQueryRow = z.infer<typeof modelSpanSampleQueryRowSchema>;

/** Map-subscript token values arrive as strings ('' when absent). */
function parseTokenCount(...raws: string[]): number | null {
  for (const raw of raws) {
    if (raw === "") continue;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function mapModelSpanSampleRow(row: ModelSpanSampleQueryRow): ModelSpanSampleRow {
  return {
    traceId: row.TraceId,
    spanId: row.SpanId,
    spanName: row.SpanName,
    model: row.Model,
    // Canonical key first, legacy alias as fallback, same coalesce order
    // as extractMetrics in span.mapper.ts.
    inputTokens: parseTokenCount(row.InputTokensRaw, row.PromptTokensRaw),
    outputTokens: parseTokenCount(row.OutputTokensRaw, row.CompletionTokensRaw),
    cacheReadTokens: parseTokenCount(row.CacheReadTokensRaw),
    cacheCreationTokens: parseTokenCount(row.CacheCreationTokensRaw),
    cacheCreation1hTokens: parseTokenCount(row.CacheCreation1hTokensRaw),
    startTimeMs: Number(row.StartTimeMs),
  };
}

/**
 * IN-tuple dedup subquery body. Renders the inner `SELECT … GROUP BY` that picks
 * the latest version (max UpdatedAt) per spanId. Caller assembles the surrounding
 * `AND (TenantId, TraceId, SpanId, UpdatedAt) IN (…)`.
 */
function dedupInTuple(extraInnerWhere: string): string {
  return `(TenantId, TraceId, SpanId, UpdatedAt) IN (
    SELECT TenantId, TraceId, SpanId, max(UpdatedAt)
    FROM ${TABLE_NAME}
    WHERE ${tenantScope("StartTime")}
      AND TraceId = {traceId:String}
      ${extraInnerWhere}
    GROUP BY TenantId, TraceId, SpanId
  )`;
}

/**
 * {@link dedupInTuple} for a batch of traces — same election, same caveat
 * about which predicates may be pushed into the subquery, `IN` over the page's
 * ids instead of one `TraceId`.
 */
function dedupInTupleForTraceIds(extraInnerWhere: string): string {
  return `(TenantId, TraceId, SpanId, UpdatedAt) IN (
    SELECT TenantId, TraceId, SpanId, max(UpdatedAt)
    FROM ${TABLE_NAME}
    WHERE ${tenantScope("StartTime")}
      AND TraceId IN {traceIds:Array(String)}
      ${extraInnerWhere}
    GROUP BY TenantId, TraceId, SpanId
  )`;
}

/**
 * One row per (tenant, trace, event name) for a page of traces, first-recorded name
 * first. A trace is its tenant and id together: an aggregate's proof fences several
 * tenants that may share a trace id, so every grouping and trim runs per tenant too.
 */
function traceEventRollupQuery(): string {
  const partitionAnd =
    "AND StartTime >= fromUnixTimestamp64Milli({fromMs:Int64}) " +
    "AND StartTime <= fromUnixTimestamp64Milli({toMs:Int64})";

  return `
    SELECT
      tenantId,
      traceId,
      name,
      nameCount,
      firstTimestamp,
      sum(nameCount) OVER (PARTITION BY tenantId, traceId) AS totalCount,
      count() OVER (PARTITION BY tenantId, traceId) AS distinctCount
    FROM (
      SELECT
        TenantId AS tenantId,
        TraceId AS traceId,
        event_name AS name,
        count() AS nameCount,
        toUnixTimestamp64Milli(min(event_timestamp)) AS firstTimestamp
      FROM (
        SELECT
          TenantId,
          TraceId,
          "Events.Timestamp" AS Events_Timestamp,
          "Events.Name" AS Events_Name
        FROM ${TABLE_NAME}
        WHERE ${tenantScope("StartTime")}
          AND TraceId IN {traceIds:Array(String)}
          AND notEmpty("Events.Name")
          ${partitionAnd}
          AND ${dedupInTupleForTraceIds(partitionAnd)}
      )
      ARRAY JOIN
        Events_Timestamp AS event_timestamp,
        Events_Name AS event_name
      GROUP BY tenantId, traceId, name
    )
    ORDER BY tenantId ASC, traceId ASC, firstTimestamp ASC, name ASC
    LIMIT {maxNames:UInt32} BY tenantId, traceId
  `;
}

/**
 * Gather {@link traceEventRollupQuery}'s flat rows into one rollup per trace,
 * keyed by {@link listedTraceKey} so two tenants holding the same trace id
 * each keep their own rollup.
 */
function toTraceEventRollups(rows: TraceEventRollupRow[]): Record<string, TraceEventRollup> {
  const rollups: Record<string, TraceEventRollup> = {};
  for (const row of rows) {
    const key = listedTraceKey({
      projectId: row.tenantId,
      traceId: row.traceId,
    });
    const rollup = (rollups[key] ??= {
      names: [],
      totalCount: asNumber(row.totalCount),
      distinctCount: asNumber(row.distinctCount),
    });
    rollup.names.push({
      name: row.name,
      count: asNumber(row.nameCount),
      firstTimestamp: asNumber(row.firstTimestamp),
    });
  }
  return rollups;
}

/**
 * Per-bucket key matchers for LangWatch signals; order must match LANGWATCH_SIGNAL_BUCKETS.
 */
const SIGNAL_BUCKET_PREDICATES: Record<LangwatchSignalBucket, string> = {
  prompt: "arrayExists(k -> startsWith(k, 'langwatch.prompt.'), keys)",
  scenario: "arrayExists(k -> startsWith(k, 'langwatch.scenario.') OR k = 'scenario.run_id', keys)",
  user: "arrayExists(k -> k = 'langwatch.user_id' OR startsWith(k, 'langwatch.user.'), keys)",
  thread:
    "arrayExists(k -> k = 'gen_ai.conversation.id' OR k = 'langgraph.thread_id' OR startsWith(k, 'langwatch.thread.'), keys)",
  evaluation: "arrayExists(k -> startsWith(k, 'langwatch.evaluation'), keys)",
  rag: "arrayExists(k -> startsWith(k, 'langwatch.rag.'), keys)",
  metadata: "arrayExists(k -> startsWith(k, 'langwatch.metadata.'), keys)",
  genai: "arrayExists(k -> startsWith(k, 'gen_ai.'), keys)",
};

const spanSummaryQueryRowSchema = z.looseObject({
  SpanId: chString,
  ParentSpanId: chString.nullable(),
  SpanName: chString,
  DurationMs: chNumber,
  StatusCode: chNumber.nullable(),
  SpanType: chString,
  // Semconv `gen_ai.tool.name` first, claude's bare `tool_name` second —
  // whichever the emitter used, the waterfall can label the tool row.
  ToolName: chString,
  // Claude joins: request_id ties llm_request spans to their api_* logs,
  // query_source scopes positional prompt pairing, tool_use_id ties tool
  // spans to tool_decision/tool_result logs. Server-side only.
  RequestId: chString,
  QuerySource: chString,
  ToolUseId: chString,
  Model: chString,
  ResponseModel: chString,
  // `SpanAttributes[...]` materialises as the raw map value; ClickHouse
  // Map values are typed `String`, so each numeric attribute arrives as
  // a stringified number (or "" when absent). Parsed in the mapper.
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
  InputImageTokens: chString,
  OutputImageTokens: chString,
  CustomInputRate: chString,
  CustomOutputRate: chString,
  CustomCacheReadRate: chString,
  CustomCacheCreationRate: chString,
  CustomCacheCreation1hRate: chString,
  LwSpanCost: chString,
  StartTimeMs: chNumber,
  UpdatedAtMs: chNumber,
});

const spanSummaryQueryRowsSchema = z.array(spanSummaryQueryRowSchema);

export type SpanSummaryQueryRow = z.infer<typeof spanSummaryQueryRowSchema>;

/** "" → null, malformed → null, otherwise the parsed number. */
function parseAttrNumber(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * An empty ClickHouse column means the span never reported the quantity, and
 * the cost cascade must not read it as a zero it can price.
 */
function toReportedValue(value: string | null | undefined): string | undefined {
  return value || undefined;
}

/**
 * The span's cost from its own tokens and rates.
 */
function computeSummaryRowCost({
  row,
  inputTokens,
  outputTokens,
}: {
  row: SpanSummaryQueryRow;
  inputTokens: number | null;
  outputTokens: number | null;
}): number {
  return computeSpanCost({
    attrs: {
      [ATTR_KEYS.GEN_AI_RESPONSE_MODEL]: toReportedValue(row.ResponseModel),
      [ATTR_KEYS.GEN_AI_REQUEST_MODEL]: toReportedValue(row.Model),
      [ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]: toReportedValue(row.CacheReadTokens),
      [ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS]: toReportedValue(
        row.CacheCreationTokens,
      ),
      [ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_1H_INPUT_TOKENS]: toReportedValue(
        row.CacheCreation1hTokens,
      ),
      [ATTR_KEYS.GEN_AI_USAGE_INPUT_CHARS]: toReportedValue(row.InputChars),
      [ATTR_KEYS.GEN_AI_USAGE_AUDIO_SECONDS]: toReportedValue(row.AudioSeconds),
      [ATTR_KEYS.GEN_AI_USAGE_INPUT_AUDIO_TOKENS]: toReportedValue(row.InputAudioTokens),
      [ATTR_KEYS.GEN_AI_USAGE_OUTPUT_AUDIO_TOKENS]: toReportedValue(row.OutputAudioTokens),
      [ATTR_KEYS.GEN_AI_USAGE_INPUT_IMAGE_TOKENS]: toReportedValue(row.InputImageTokens),
      [ATTR_KEYS.GEN_AI_USAGE_OUTPUT_IMAGE_TOKENS]: toReportedValue(row.OutputImageTokens),
      [ATTR_KEYS.LANGWATCH_MODEL_INPUT_COST_PER_TOKEN]: toReportedValue(row.CustomInputRate),
      [ATTR_KEYS.LANGWATCH_MODEL_OUTPUT_COST_PER_TOKEN]: toReportedValue(row.CustomOutputRate),
      [ATTR_KEYS.LANGWATCH_MODEL_CACHE_READ_COST_PER_TOKEN]: toReportedValue(
        row.CustomCacheReadRate,
      ),
      [ATTR_KEYS.LANGWATCH_MODEL_CACHE_CREATION_COST_PER_TOKEN]: toReportedValue(
        row.CustomCacheCreationRate,
      ),
      [ATTR_KEYS.LANGWATCH_MODEL_CACHE_CREATION_1H_COST_PER_TOKEN]: toReportedValue(
        row.CustomCacheCreation1hRate,
      ),
      [ATTR_KEYS.LANGWATCH_SPAN_COST]: toReportedValue(row.LwSpanCost),
    } as NormalizedAttributes,
    model: row.ResponseModel || toReportedValue(row.Model),
    promptTokens: inputTokens,
    completionTokens: outputTokens,
  });
}

const eventRowSchema = z.looseObject({
  event_id: chString,
  trace_id: chString,
  project_id: chString,
  started_at: numeric,
  event_type: chString,
  attributes: chStringMap,
});

const eventRowsSchema = z.array(eventRowSchema);

type EventRow = z.infer<typeof eventRowSchema>;

const traceEventRowSchema = z.looseObject({
  spanId: chString,
  timestamp: numeric,
  name: chString,
  attributes: chStringMap,
});

const traceEventRowsSchema = z.array(traceEventRowSchema);

const traceEventRollupRowSchema = z.looseObject({
  tenantId: chString,
  traceId: chString,
  name: chString,
  nameCount: numeric,
  firstTimestamp: numeric,
  totalCount: numeric,
  distinctCount: numeric,
});

const traceEventRollupRowsSchema = z.array(traceEventRollupRowSchema);

type TraceEventRollupRow = z.infer<typeof traceEventRollupRowSchema>;

const resourceInfoRowSchema = z.looseObject({
  SpanId: chString,
  ParentSpanId: chString.nullable(),
  StartTimeMs: chNumber,
  ResourceAttributes: chStringMap,
  ScopeName: chString.nullable(),
  ScopeVersion: chString.nullable(),
});

const resourceInfoRowsSchema = z.array(resourceInfoRowSchema);

const occurredAtRowSchema = z.looseObject({ occurredAtMs: numeric.nullable() });

const occurredAtRowsSchema = z.array(occurredAtRowSchema);

const signalsRowSchema = z.looseObject({ SpanId: chString, Signals: z.array(chString) });

const signalsRowsSchema = z.array(signalsRowSchema);

const totalRowSchema = z.looseObject({ Total: numeric });

const totalRowsSchema = z.array(totalRowSchema);

const modelUsageRowSchema = z.looseObject({
  Model: chString,
  SpanCount: numeric,
  LastSeenMs: numeric,
});

const modelUsageRowsSchema = z.array(modelUsageRowSchema);

/** The fence a read ran under, for a log line that used to name the tenant. */
function scopeOf(authorization: Authorization): string {
  return tenantScopeKey({ authorization, reads: "traces" });
}

/** JSONEachRow renders 64-bit integers as strings; narrow both back to number. */
function asNumber(value: string | number): number {
  return typeof value === "string" ? parseInt(value, 10) : value;
}

function mapEventRow(row: EventRow): ElasticSearchEvent {
  const startedAt =
    typeof row.started_at === "string" ? parseInt(row.started_at, 10) : row.started_at;

  const metrics: { key: string; value: number }[] = [];
  const eventDetails: { key: string; value: string }[] = [];

  for (const [key, value] of Object.entries(row.attributes)) {
    const isMetricKey =
      key === "vote" ||
      key === "score" ||
      key.startsWith("metrics.") ||
      key.startsWith("event.metrics.");
    if (isMetricKey) {
      const metricKey = key.replace(/^(event\.)?metrics\./, "");
      metrics.push({ key: metricKey, value: parseFloat(value) || 0 });
    } else {
      eventDetails.push({ key, value });
    }
  }

  return {
    event_id: row.event_id,
    event_type: row.event_type,
    project_id: row.project_id,
    trace_id: row.trace_id,
    timestamps: {
      started_at: startedAt,
      inserted_at: startedAt,
      updated_at: startedAt,
    },
    metrics,
    event_details: eventDetails,
  };
}

/**
 * Matches strings that look like decimal numbers (including scientific notation).
 * Rejects hex (0x), octal (0o), and binary (0b) literals that Number() silently accepts.
 */
type ClickHouseSpanWriteRecord = WithDateWrites<
  ClickHouseSpanRecord,
  "StartTime" | "EndTime" | "Events.Timestamp" | "CreatedAt" | "UpdatedAt"
>;

interface ClickHouseSpanRecord {
  ProjectionId: string;
  TenantId: string;
  TraceId: string;
  SpanId: string;
  ParentSpanId: string | null;
  ParentTraceId: string | null;
  ParentIsRemote: boolean | null;
  Sampled: boolean;
  StartTime: number;
  EndTime: number;
  DurationMs: number;
  SpanName: string;
  SpanKind: number;
  ServiceName: string;
  ResourceAttributes: Record<string, string>;
  SpanAttributes: Record<string, string>;
  StatusCode: number | null;
  StatusMessage: string | null;
  ScopeName: string;
  ScopeVersion: string | null;
  "Events.Timestamp": number[];
  "Events.Name": string[];
  "Events.Attributes": Record<string, string>[];
  "Links.TraceId": string[];
  "Links.SpanId": string[];
  "Links.Attributes": Record<string, string>[];
  DroppedAttributesCount: 0;
  DroppedEventsCount: 0;
  DroppedLinksCount: 0;
  Cost: number | null;
  NonBilledCost: number | null;
  CreatedAt: number;
  UpdatedAt: number;
  _retention_days: number;
}

/** The columns {@link SpanStorageClickHouseRepository.findStoredSpansByTraceId} selects. */
const storedSpanRowSchema = z.looseObject({
  SpanId: chString,
  TraceId: chString,
  ParentSpanId: chString.nullable(),
  SpanName: chString,
  SpanAttributes: chStringMap,
  StartTimeMs: chNumber,
  EndTimeMs: chNumber,
  DurationMs: chNumber,
  StatusCode: chNumber.nullable(),
  StatusMessage: chString.nullable(),
});

const storedSpanRowsSchema = z.array(storedSpanRowSchema);

function storedTraceSpanOf(row: z.infer<typeof storedSpanRowSchema>): StoredTraceSpan {
  return {
    spanId: row.SpanId,
    traceId: row.TraceId,
    parentSpanId: row.ParentSpanId,
    name: row.SpanName,
    spanAttributes: ensureStringRecord(row.SpanAttributes),
    startTimeUnixMs: row.StartTimeMs,
    endTimeUnixMs: row.EndTimeMs,
    durationMs: row.DurationMs,
    statusCode: row.StatusCode,
    statusMessage: row.StatusMessage,
  };
}

/**
 * Writes resolve the tenant's own client by the span's tenant id, the way the
 * projection hands it over. Reads never name a tenant: they go through the
 * authorized client, which fences every statement by the proof (ADR-177 block C).
 */
export class SpanStorageClickHouseRepository implements SpanStorageRepository {
  static create(deps: {
    resolveClient: ClickHouseClientResolver;
    clickhouse: AuthorizedClickHouse;
  }): SpanStorageClickHouseRepository {
    return new SpanStorageClickHouseRepository(deps);
  }

  constructor(
    private readonly deps: {
      resolveClient: ClickHouseClientResolver;
      clickhouse: AuthorizedClickHouse;
    },
  ) {}

  private reader(authorization: Authorization): TenantScopedReader {
    return this.deps.clickhouse.as(authorization, { reads: "traces" });
  }

  async insertSpan(span: SpanInsertData): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: span.tenantId },
      "SpanStorageClickHouseRepository.insertSpan",
    );

    try {
      const client = await this.deps.resolveClient(span.tenantId);
      const record = this.toClickHouseRecord(span);
      await client.insert({
        table: TABLE_NAME,
        values: [record],
        format: "JSONEachRow",
        clickhouse_settings: SPAN_INSERT_SETTINGS,
      });
    } catch (error) {
      logger.warn(
        {
          tenantId: span.tenantId,
          spanId: span.spanId,
          traceId: span.traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to insert span into ClickHouse",
      );
      throw error;
    }
  }

  async insertSpans(spans: SpanInsertData[]): Promise<void> {
    if (spans.length === 0) return;

    for (const span of spans) {
      EventUtils.validateTenantId(
        { tenantId: span.tenantId },
        "SpanStorageClickHouseRepository.insertSpans",
      );
    }

    // Enforce that a single bulk insert only writes spans for one tenant —
    // the client is resolved once from the first span's tenantId, so mixed
    // batches would silently route another tenant's data through the wrong
    // (possibly private) ClickHouse instance.
    const tenantId = spans[0]!.tenantId;
    for (const span of spans) {
      if (span.tenantId !== tenantId) {
        throw new SecurityError({
          operation: "SpanStorageClickHouseRepository.insertSpans",
          message: "all spans in a single batch must share the same tenantId",
          tenantId,
          context: { mismatchedTenantId: span.tenantId },
        });
      }
    }

    try {
      const client = await this.deps.resolveClient(tenantId);
      const records = spans.map((span) => this.toClickHouseRecord(span));
      await client.insert({
        table: TABLE_NAME,
        values: records,
        format: "JSONEachRow",
        clickhouse_settings: SPAN_INSERT_SETTINGS,
      });
    } catch (error) {
      logger.warn(
        {
          count: spans.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to bulk insert spans into ClickHouse",
      );
      throw error;
    }
  }

  async findSpansByTraceId({
    authorization,
    traceId,
    limit,
    occurredAtMs,
  }: {
    authorization: Authorization;
    traceId: string;
    limit?: number;
  } & OccurredAtHint): Promise<Span[]> {
    // Hard ceiling, applied unconditionally: a leaked trace_id with a huge span
    // count can never load the pipeline through this path, regardless of caller.
    const effectiveLimit = SpanStorageRepository.clampSpanReadLimit(limit);

    try {
      return await this.readTraceSpans<Span[]>(
        { authorization, traceId, occurredAtMs },
        (rows) => rows.length === 0,
        async (window) => {
          const partition = partitionFragment(window);
          const client = this.reader(authorization);
          const result = await client.query({
            query: `
              SELECT ${FULL_SPAN_SELECT}
              FROM ${TABLE_NAME}
              WHERE ${tenantScope("StartTime")}
                AND TraceId = {traceId:String}
                ${partition.sqlAnd}
                AND ${dedupInTuple(partition.sqlAndInner)}
              ORDER BY StartTimeMs ASC
              LIMIT {limit:UInt32}
            `,
            query_params: {
              traceId,
              limit: effectiveLimit,
              ...partition.params,
            },
            clickhouse_settings: SINGLE_TRACE_READ_SETTINGS,
            format: "JSONEachRow",
          });

          const rows = fullSpanRowsSchema.parse(await result.json());
          return mapNormalizedSpansToSpans(rows.map(mapChRowToNormalized));
        },
      );
    } catch (error) {
      logger.warn(
        {
          scope: scopeOf(authorization),
          traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to get spans by trace ID from ClickHouse",
      );
      throw error;
    }
  }

  async findNormalizedSpansByTraceId({
    authorization,
    traceId,
    limit,
    occurredAtMs,
  }: {
    authorization: Authorization;
    traceId: string;
    limit?: number;
  } & OccurredAtHint): Promise<NormalizedSpan[]> {
    // Hard ceiling so even a leaked trace_id can never load the pipeline.
    const effectiveLimit = SpanStorageRepository.clampSpanReadLimit(limit);

    // The ±window hint prunes partitions on the happy path; the empty-result
    // fallback covers a stale/wrong hint. The window (±2 days) dwarfs any real
    // trace duration, so a derivation read can't realistically split across it.
    try {
      return await this.readTraceSpans<NormalizedSpan[]>(
        { authorization, traceId, occurredAtMs },
        (rows) => rows.length === 0,
        async (window) => {
          const partition = partitionFragment(window);
          const client = this.reader(authorization);
          const result = await client.query({
            query: `
              SELECT ${FULL_SPAN_SELECT}
              FROM ${TABLE_NAME}
              WHERE ${tenantScope("StartTime")}
                AND TraceId = {traceId:String}
                ${partition.sqlAnd}
                AND ${dedupInTuple(partition.sqlAndInner)}
              ORDER BY StartTimeMs ASC
              LIMIT {limit:UInt32}
            `,
            query_params: {
              traceId,
              limit: effectiveLimit,
              ...partition.params,
            },
            clickhouse_settings: SINGLE_TRACE_READ_SETTINGS,
            format: "JSONEachRow",
          });

          const rows = fullSpanRowsSchema.parse(await result.json());
          return rows.map(mapChRowToNormalized);
        },
      );
    } catch (error) {
      logger.warn(
        {
          scope: scopeOf(authorization),
          traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to get normalized spans by trace ID from ClickHouse",
      );
      throw error;
    }
  }

  /** A trace's spans with their attributes as stored, unparsed (the prompt playground's read). */
  async findStoredSpansByTraceId({
    authorization,
    traceId,
    limit,
    occurredAtMs,
  }: {
    authorization: Authorization;
    traceId: string;
    limit?: number;
  } & OccurredAtHint): Promise<StoredTraceSpan[]> {
    const effectiveLimit = SpanStorageRepository.clampSpanReadLimit(limit, {
      max: MAX_STORED_TRACE_SPAN_ROWS,
    });

    try {
      return await this.readTraceSpans<StoredTraceSpan[]>(
        { authorization, traceId, occurredAtMs },
        (rows) => rows.length === 0,
        async (window) => {
          const partition = partitionFragment(window);
          const client = this.reader(authorization);
          const result = await client.query({
            query: `
              SELECT
                SpanId,
                TraceId,
                ParentSpanId,
                SpanName,
                SpanAttributes,
                toUnixTimestamp64Milli(StartTime) AS StartTimeMs,
                toUnixTimestamp64Milli(EndTime) AS EndTimeMs,
                DurationMs,
                StatusCode,
                StatusMessage
              FROM ${TABLE_NAME}
              WHERE ${tenantScope("StartTime")}
                AND TraceId = {traceId:String}
                ${partition.sqlAnd}
                AND ${dedupInTuple(partition.sqlAndInner)}
              ORDER BY StartTimeMs ASC
              LIMIT {limit:UInt32}
            `,
            query_params: {
              traceId,
              limit: effectiveLimit,
              ...partition.params,
            },
            clickhouse_settings: SINGLE_TRACE_READ_SETTINGS,
            format: "JSONEachRow",
          });

          return storedSpanRowsSchema.parse(await result.json()).map(storedTraceSpanOf);
        },
      );
    } catch (error) {
      logger.warn(
        {
          scope: scopeOf(authorization),
          traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to find stored spans by trace ID from ClickHouse",
      );
      throw error;
    }
  }

  async findSpanByIds({
    authorization,
    traceId,
    spanId,
    occurredAtMs,
  }: {
    authorization: Authorization;
    traceId: string;
    spanId: string;
  } & OccurredAtHint): Promise<Span | null> {
    try {
      return await this.readTraceSpans<Span | null>(
        { authorization, traceId, occurredAtMs },
        (span) => span === null,
        async (window) => {
          const row = await this.fetchNormalizedSpanRow({
            authorization,
            traceId,
            spanId,
            window,
          });
          if (row === null) return null;
          const [span] = mapNormalizedSpansToSpans([row]);
          return span ?? null;
        },
      );
    } catch (error) {
      logger.warn(
        {
          scope: scopeOf(authorization),
          traceId,
          spanId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to get span by ids from ClickHouse",
      );
      throw error;
    }
  }

  /**
   * Windowed read for derivation consumers; miss is expected and cheap to retry.
   */
  async findNormalizedSpanById({
    authorization,
    traceId,
    spanId,
    occurredAtMs,
  }: NormalizedSpanByIdParams): Promise<NormalizedSpan | null> {
    try {
      return await queryWindowed<NormalizedSpan | null>({
        table: TABLE_NAME,
        hintMs: occurredAtMs,
        windowMs: DEFAULT_PARTITION_WINDOW_MS,
        fallback: "none",
        isEmpty: (row) => row === null,
        run: (window) =>
          this.fetchNormalizedSpanRow({
            authorization,
            traceId,
            spanId,
            window,
            // Derivation consumers lift scalar attributes only; the nested
            // Events/Links columns are both unused here and the source of the
            // `Attempt to read after eof` failures this read retries on.
            select: DERIVATION_SPAN_SELECT,
          }),
      });
    } catch (error) {
      logger.warn(
        {
          scope: scopeOf(authorization),
          traceId,
          spanId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to get normalized span by id from ClickHouse",
      );
      throw error;
    }
  }

  /**
   * Single-span fetch via LazilyRead optimization to defer heavy columns.
   */
  private async fetchNormalizedSpanRow({
    authorization,
    traceId,
    spanId,
    window,
    select = FULL_SPAN_SELECT,
  }: {
    authorization: Authorization;
    traceId: string;
    spanId: string;
    window: WindowFragment | null;
    select?: string;
  }): Promise<NormalizedSpan | null> {
    const partition = partitionFragment(window);
    const client = this.reader(authorization);
    const result = await client.query({
      query: `
        SELECT ${select}
        FROM ${TABLE_NAME}
        WHERE ${tenantScope("StartTime")}
          AND TraceId = {traceId:String}
          AND SpanId = {spanId:String}
          ${partition.sqlAnd}
        ORDER BY UpdatedAt DESC
        LIMIT 1
      `,
      query_params: { traceId, spanId, ...partition.params },
      clickhouse_settings: SINGLE_SPAN_FETCH_SETTINGS,
      format: "JSONEachRow",
    });

    const rows = fullSpanRowsSchema.parse(await result.json());
    if (rows.length === 0) return null;
    return mapChRowToNormalized(rows[0]!);
  }

  async findSpanResourcesByTraceId({
    authorization,
    traceId,
    occurredAtMs,
  }: {
    authorization: Authorization;
    traceId: string;
  } & OccurredAtHint): Promise<SpanResourceInfo[]> {
    return this.readTraceSpans<SpanResourceInfo[]>(
      { authorization, traceId, occurredAtMs },
      (rows) => rows.length === 0,
      async (window) => {
        const partition = partitionFragment(window);
        const client = this.reader(authorization);
        // Light projection: only the resource/scope columns plus the bits
        // needed for ordering. SpanAttributes/Events/Links are heavy and
        // unrelated to OTel resource info, so don't read them.
        const result = await client.query({
          query: `
            SELECT
              SpanId,
              ParentSpanId,
              toUnixTimestamp64Milli(StartTime) AS StartTimeMs,
              ResourceAttributes,
              ScopeName,
              ScopeVersion
            FROM ${TABLE_NAME}
            WHERE ${tenantScope("StartTime")}
              AND TraceId = {traceId:String}
              ${partition.sqlAnd}
              AND ${dedupInTuple(partition.sqlAndInner)}
            ORDER BY StartTimeMs ASC
            LIMIT ${MAX_LIGHT_SPAN_READ_ROWS}
          `,
          query_params: { traceId, ...partition.params },
          format: "JSONEachRow",
        });

        const rows = resourceInfoRowsSchema.parse(await result.json());

        return rows.map((row) => ({
          spanId: row.SpanId,
          parentSpanId: row.ParentSpanId,
          startTimeMs: row.StartTimeMs,
          resourceAttributes: ensureStringRecord(row.ResourceAttributes),
          scopeName: row.ScopeName ?? null,
          scopeVersion: row.ScopeVersion ?? null,
        }));
      },
    );
  }

  /**
   * Resolve trace OccurredAt for partition pruning; two-phase: recent window then full.
   */
  private async resolveTraceOccurredAtMs({
    authorization,
    traceId,
  }: {
    authorization: Authorization;
    traceId: string;
  }): Promise<number | undefined> {
    const recent = await this.queryTraceOccurredAtMs({
      authorization,
      traceId,
      sinceMs: nowInstant().epochMilliseconds - RESOLVER_RECENT_WINDOW_MS,
    });
    if (recent !== undefined) return recent;
    return this.queryTraceOccurredAtMs({ authorization, traceId });
  }

  private async queryTraceOccurredAtMs({
    authorization,
    traceId,
    sinceMs,
  }: {
    authorization: Authorization;
    traceId: string;
    sinceMs?: number;
  }): Promise<number | undefined> {
    const client = this.reader(authorization);
    const windowPredicate =
      sinceMs !== undefined ? "AND OccurredAt >= fromUnixTimestamp64Milli({sinceMs:Int64})" : "";
    const result = await client.query({
      query: `
        SELECT toUnixTimestamp64Milli(min(OccurredAt)) AS occurredAtMs
        FROM trace_summaries
        WHERE ${tenantScope("OccurredAt")}
          AND TraceId = {traceId:String}
          ${windowPredicate}
      `,
      query_params: sinceMs !== undefined ? { traceId, sinceMs } : { traceId },
      format: "JSONEachRow",
    });
    const rows = occurredAtRowsSchema.parse(await result.json());
    const raw = rows[0]?.occurredAtMs;
    if (raw === null || raw === undefined) return undefined;
    // `min` over no matching rows yields the epoch default (0); treat that — and
    // any non-positive value — as "unknown" so the caller stays unbounded.
    const ms = typeof raw === "string" ? Number(raw) : raw;
    return Number.isFinite(ms) && ms > 0 ? ms : undefined;
  }

  /**
   * Partition-pruned execution for single-trace Events.* reads via trace OccurredAt.
   */
  private async readTraceEvents<T>(
    {
      authorization,
      traceId,
      occurredAtMs,
    }: { authorization: Authorization; traceId: string } & OccurredAtHint,
    run: (window: WindowFragment | null) => Promise<T>,
  ): Promise<T> {
    const hintMs =
      occurredAtMs ?? (await this.resolveTraceOccurredAtMs({ authorization, traceId }));
    return queryWindowed<T>({
      table: TABLE_NAME,
      hintMs: hintMs ?? null,
      windowMs: DEFAULT_PARTITION_WINDOW_MS,
      fallback: "none",
      // `fallback: "none"` never widens, so `isEmpty` is never consulted.
      isEmpty: () => false,
      run,
    });
  }

  /**
   * Partition-pruned execution for single-trace stored_spans reads.
   */
  private async readTraceSpans<T>(
    {
      authorization,
      traceId,
      occurredAtMs,
    }: { authorization: Authorization; traceId: string } & OccurredAtHint,
    isEmpty: (result: T) => boolean,
    run: (window: WindowFragment | null) => Promise<T>,
  ): Promise<T> {
    const hintMs =
      occurredAtMs ?? (await this.resolveTraceOccurredAtMs({ authorization, traceId }));
    return queryWindowed<T>({
      table: TABLE_NAME,
      hintMs: hintMs ?? null,
      windowMs: DEFAULT_PARTITION_WINDOW_MS,
      fallback: "unbounded",
      isEmpty,
      run,
    });
  }

  async findTraceEventsByTraceId({
    authorization,
    traceId,
    occurredAtMs,
  }: {
    authorization: Authorization;
    traceId: string;
  } & OccurredAtHint): Promise<DerivedTraceEvent[]> {
    try {
      return await this.readTraceEvents<DerivedTraceEvent[]>(
        { authorization, traceId, occurredAtMs },
        async (window) => {
          const partition = partitionFragment(window);
          const client = this.reader(authorization);
          // Events-only ARRAY JOIN to avoid heavy attributes; row-level dedup pre-expansion.
          const result = await client.query({
            query: `
              SELECT
                SpanId AS spanId,
                toUnixTimestamp64Milli(event_timestamp) AS timestamp,
                event_name AS name,
                event_attrs AS attributes
              FROM (
                SELECT
                  SpanId,
                  "Events.Timestamp" AS Events_Timestamp,
                  "Events.Name" AS Events_Name,
                  "Events.Attributes" AS Events_Attributes
                FROM ${TABLE_NAME}
                WHERE ${tenantScope("StartTime")}
                  AND TraceId = {traceId:String}
                  ${partition.sqlAnd}
                  AND ${dedupInTuple(partition.sqlAndInner)}
              )
              ARRAY JOIN
                Events_Timestamp AS event_timestamp,
                Events_Name AS event_name,
                Events_Attributes AS event_attrs
              ORDER BY event_timestamp ASC
              LIMIT ${MAX_LIGHT_SPAN_READ_ROWS}
            `,
            query_params: { traceId, ...partition.params },
            format: "JSONEachRow",
          });

          const rows = traceEventRowsSchema.parse(await result.json());
          return rows.map((r) => ({
            spanId: r.spanId,
            timestamp: typeof r.timestamp === "string" ? parseInt(r.timestamp, 10) : r.timestamp,
            name: r.name,
            attributes: r.attributes ?? {},
          }));
        },
      );
    } catch (error) {
      logger.warn(
        {
          scope: scopeOf(authorization),
          traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to get trace events by trace ID from ClickHouse",
      );
      throw error;
    }
  }

  async findTraceEventRollupsByTraceIds({
    authorization,
    traceIds,
    timeRange,
  }: TraceEventRollupParams): Promise<Record<string, TraceEventRollup>> {
    if (traceIds.length === 0) return {};

    try {
      const client = this.reader(authorization);
      // Pad time range by partition window to cover all spans within list traces.
      const fromMs = timeRange.from - DEFAULT_PARTITION_WINDOW_MS;
      const toMs = timeRange.to + DEFAULT_PARTITION_WINDOW_MS;
      const result = await client.query({
        query: traceEventRollupQuery(),
        query_params: {
          traceIds,
          fromMs,
          toMs,
          maxNames: MAX_EVENT_NAMES_PER_TRACE,
        },
        format: "JSONEachRow",
      });

      return toTraceEventRollups(traceEventRollupRowsSchema.parse(await result.json()));
    } catch (error) {
      logger.warn(
        {
          scope: scopeOf(authorization),
          traceCount: traceIds.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to get trace event rollups from ClickHouse",
      );
      throw error;
    }
  }

  async findEventsByTraceId({
    authorization,
    traceId,
    occurredAtMs,
  }: {
    authorization: Authorization;
    traceId: string;
  } & OccurredAtHint): Promise<ElasticSearchEvent[]> {
    try {
      return await this.readTraceEvents<ElasticSearchEvent[]>(
        { authorization, traceId, occurredAtMs },
        async (window) => {
          const partition = partitionFragment(window);
          const client = this.reader(authorization);
          // Same shape as `getTraceEventsByTraceId`: dedup at row level inside
          // the subquery, then ARRAY JOIN the Events.* arrays of the survivors,
          // and finally drop exception events (which is a per-event filter).
          const result = await client.query({
            query: `
              SELECT
                SpanId AS event_id,
                TraceId AS trace_id,
                TenantId AS project_id,
                toUnixTimestamp64Milli(event_timestamp) AS started_at,
                event_name AS event_type,
                event_attrs AS attributes
              FROM (
                SELECT
                  TenantId, TraceId, SpanId,
                  "Events.Timestamp" AS Events_Timestamp,
                  "Events.Name" AS Events_Name,
                  "Events.Attributes" AS Events_Attributes
                FROM ${TABLE_NAME}
                WHERE ${tenantScope("StartTime")}
                  AND TraceId = {traceId:String}
                  ${partition.sqlAnd}
                  AND ${dedupInTuple(partition.sqlAndInner)}
              )
              ARRAY JOIN
                Events_Timestamp AS event_timestamp,
                Events_Name AS event_name,
                Events_Attributes AS event_attrs
              WHERE event_name != 'exception'
              ORDER BY event_timestamp DESC
            `,
            query_params: { traceId, ...partition.params },
            format: "JSONEachRow",
          });

          const rows = eventRowsSchema.parse(await result.json());
          return rows.map(mapEventRow);
        },
      );
    } catch (error) {
      logger.warn(
        {
          scope: scopeOf(authorization),
          traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to get events by trace ID from ClickHouse",
      );
      throw error;
    }
  }

  async findSpanEvents({
    authorization,
    traceId,
    spanId,
    occurredAtMs,
  }: {
    authorization: Authorization;
    traceId: string;
    spanId: string;
  } & OccurredAtHint): Promise<ElasticSearchEvent[]> {
    try {
      return await this.readTraceEvents<ElasticSearchEvent[]>(
        { authorization, traceId, occurredAtMs },
        async (window) => {
          const partition = partitionFragment(window);
          const client = this.reader(authorization);
          const result = await client.query({
            query: `
              SELECT
                SpanId AS event_id,
                TraceId AS trace_id,
                TenantId AS project_id,
                toUnixTimestamp64Milli(event_timestamp) AS started_at,
                event_name AS event_type,
                event_attrs AS attributes
              FROM (
                -- Single-span fetch. Same rationale and same investigation
                -- as findSpanByIds (see SINGLE_SPAN_FETCH_SETTINGS comment).
                -- LazilyRead survives through this subquery + ARRAY JOIN
                -- composition: Events.Timestamp / Events.Name /
                -- Events.Attributes are deferred past the inner LIMIT 1
                -- and only the granule's key columns are read up front.
                -- ARRAY JOIN unrolls the events from the single picked
                -- row after the lazy read materialises it.
                SELECT
                  TenantId, TraceId, SpanId,
                  "Events.Timestamp" AS Events_Timestamp,
                  "Events.Name" AS Events_Name,
                  "Events.Attributes" AS Events_Attributes
                FROM ${TABLE_NAME}
                WHERE ${tenantScope("StartTime")}
                  AND TraceId = {traceId:String}
                  AND SpanId = {spanId:String}
                  ${partition.sqlAnd}
                ORDER BY UpdatedAt DESC
                LIMIT 1
              )
              ARRAY JOIN
                Events_Timestamp AS event_timestamp,
                Events_Name AS event_name,
                Events_Attributes AS event_attrs
              ORDER BY event_timestamp DESC
            `,
            query_params: { traceId, spanId, ...partition.params },
            clickhouse_settings: SINGLE_SPAN_FETCH_SETTINGS,
            format: "JSONEachRow",
          });

          const rows = eventRowsSchema.parse(await result.json());
          return rows.map(mapEventRow);
        },
      );
    } catch (error) {
      logger.warn(
        {
          scope: scopeOf(authorization),
          traceId,
          spanId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to get events by span ID from ClickHouse",
      );
      throw error;
    }
  }

  async findSpanSummaryByTraceId({
    authorization,
    traceId,
    occurredAtMs,
  }: {
    authorization: Authorization;
    traceId: string;
  } & OccurredAtHint): Promise<SpanSummaryRow[]> {
    return this.readTraceSpans<SpanSummaryRow[]>(
      { authorization, traceId, occurredAtMs },
      (rows) => rows.length === 0,
      async (window) => {
        const partition = partitionFragment(window);
        const client = this.reader(authorization);
        const result = await client.query({
          query: `
            SELECT ${SUMMARY_SPAN_SELECT}
            FROM ${TABLE_NAME}
            WHERE ${tenantScope("StartTime")}
              AND TraceId = {traceId:String}
              ${partition.sqlAnd}
              AND ${dedupInTuple(partition.sqlAndInner)}
            ORDER BY StartTimeMs ASC
            LIMIT ${MAX_LIGHT_SPAN_READ_ROWS}
          `,
          query_params: { traceId, ...partition.params },
          format: "JSONEachRow",
        });

        const rows = spanSummaryQueryRowsSchema.parse(await result.json());
        return rows.map((row) => SpanStorageClickHouseRepository.mapSpanSummaryRow(row));
      },
    );
  }

  async findLangwatchSignalsByTraceId({
    authorization,
    traceId,
    occurredAtMs,
  }: {
    authorization: Authorization;
    traceId: string;
  } & OccurredAtHint): Promise<SpanLangwatchSignalsRow[]> {
    return this.readTraceSpans<SpanLangwatchSignalsRow[]>(
      { authorization, traceId, occurredAtMs },
      (rows) => rows.length === 0,
      async (window) => {
        const partition = partitionFragment(window);
        const client = this.reader(authorization);
        // Reads `mapKeys(SpanAttributes)` once per row into a CTE-style
        // alias (`keys`) so each bucket predicate doesn't re-materialize
        // the key array. Heavy attribute *values* are never read — only
        // their keys — keeping this scan an order of magnitude lighter
        // than getSpansByTraceId.
        const result = await client.query({
          query: `
            SELECT
              SpanId,
              arrayFilter(x -> x != '', [
                ${LANGWATCH_SIGNAL_BUCKETS.map(
                  (bucket) => `if(${SIGNAL_BUCKET_PREDICATES[bucket]}, '${bucket}', '')`,
                ).join(",\n                ")}
              ]) AS Signals
            FROM (
              SELECT
                SpanId,
                mapKeys(SpanAttributes) AS keys
              FROM ${TABLE_NAME}
              WHERE ${tenantScope("StartTime")}
                AND TraceId = {traceId:String}
                ${partition.sqlAnd}
                AND ${dedupInTuple(partition.sqlAndInner)}
              -- Order before the cap so a runaway trace consistently yields the
              -- same earliest-starting prefix; an unordered LIMIT would let
              -- ClickHouse return an arbitrary subset that varies with merges
              -- and part ordering, making which spans carry signals
              -- nondeterministic across calls. Must be the raw StartTime
              -- column — this subquery computes no StartTimeMs alias.
              ORDER BY StartTime ASC
              LIMIT ${MAX_LIGHT_SPAN_READ_ROWS}
            )
          `,
          query_params: { traceId, ...partition.params },
          format: "JSONEachRow",
        });

        const rows = signalsRowsSchema.parse(await result.json());

        const validBuckets = new Set<string>(LANGWATCH_SIGNAL_BUCKETS);
        return rows
          .filter((r) => Array.isArray(r.Signals) && r.Signals.length > 0)
          .map((r) => ({
            spanId: r.SpanId,
            signals: r.Signals.filter((s): s is LangwatchSignalBucket => validBuckets.has(s)),
          }))
          .filter((r) => r.signals.length > 0);
      },
    );
  }

  async listSpansPaginated({
    authorization,
    traceId,
    limit,
    offset,
    occurredAtMs,
  }: {
    authorization: Authorization;
    traceId: string;
    limit: number;
    offset: number;
  } & OccurredAtHint): Promise<{ spans: Span[]; total: number }> {
    return this.readTraceSpans<{ spans: Span[]; total: number }>(
      { authorization, traceId, occurredAtMs },
      (result) => result.spans.length === 0,
      async (window) => {
        const partition = partitionFragment(window);
        const client = this.reader(authorization);
        // Parallel queries: page reads full spans, count reads only dedup keys for efficiency.
        const [pageResult, countResult] = await Promise.all([
          client.query({
            query: `
              SELECT ${FULL_SPAN_SELECT}
              FROM ${TABLE_NAME}
              WHERE ${tenantScope("StartTime")}
                AND TraceId = {traceId:String}
                ${partition.sqlAnd}
                AND ${dedupInTuple(partition.sqlAndInner)}
              ORDER BY StartTime ASC
              LIMIT {limit:UInt32}
              OFFSET {offset:UInt32}
            `,
            query_params: {
              traceId,
              limit,
              offset,
              ...partition.params,
            },
            format: "JSONEachRow",
          }),
          client.query({
            query: `
              SELECT count(DISTINCT SpanId) AS Total
              FROM ${TABLE_NAME}
              WHERE ${tenantScope("StartTime")}
                AND TraceId = {traceId:String}
                ${partition.sqlAnd}
            `,
            query_params: { traceId, ...partition.params },
            format: "JSONEachRow",
          }),
        ]);

        const pageRows = fullSpanRowsSchema.parse(await pageResult.json());
        const countRows = totalRowsSchema.parse(await countResult.json());
        const total = countRows.length > 0 ? Number(countRows[0]!.Total) : 0;

        return {
          spans: mapNormalizedSpansToSpans(pageRows.map(mapChRowToNormalized)),
          total,
        };
      },
    );
  }

  async findSpansSince({
    authorization,
    traceId,
    sinceStartTimeMs,
  }: {
    authorization: Authorization;
    traceId: string;
    sinceStartTimeMs: number;
  } & OccurredAtHint): Promise<Span[]> {
    // Poll reader: `StartTime > sinceStartTimeMs` is already a partition-pruning
    // lower bound, so this does NOT resolve or clamp to the trace's OccurredAt
    // window. A `StartTime <= OccurredAt + 2d` upper bound would silently hide
    // new spans on a trace still active more than 2 days after its
    // trace_summaries.OccurredAt (the live delta view would just stop updating).
    const sinceFilter = "AND StartTime > fromUnixTimestamp64Milli({sinceStartTimeMs:Int64})";
    const client = this.reader(authorization);
    const result = await client.query({
      query: `
        SELECT ${FULL_SPAN_SELECT}
        FROM ${TABLE_NAME}
        WHERE ${tenantScope("StartTime")}
          AND TraceId = {traceId:String}
          ${sinceFilter}
          AND ${dedupInTuple(sinceFilter)}
        ORDER BY StartTime ASC
        LIMIT ${MAX_DERIVATION_SPANS}
      `,
      query_params: { traceId, sinceStartTimeMs },
      format: "JSONEachRow",
    });

    const rows = fullSpanRowsSchema.parse(await result.json());
    return mapNormalizedSpansToSpans(rows.map(mapChRowToNormalized));
  }

  async findModelUsageStats({
    authorization,
    fromMs,
    limit,
  }: {
    authorization: Authorization;
    fromMs: number;
    limit: number;
  }): Promise<ModelUsageStatsRow[]> {
    const client = this.reader(authorization);
    // Cross-trace scan bounded by the StartTime window (partition pruning)
    // and reading only two Map subscripts, no heavy attribute values.
    // `uniq` (approximate) instead of count() so ReplacingMergeTree row
    // versions don't inflate the per-model span counts.
    const result = await client.query({
      query: `
        SELECT
          ${MODEL_ATTR_SELECT} AS Model,
          uniq(TraceId, SpanId) AS SpanCount,
          toUnixTimestamp64Milli(max(StartTime)) AS LastSeenMs
        FROM ${TABLE_NAME}
        WHERE ${tenantScope("StartTime")}
          AND StartTime >= fromUnixTimestamp64Milli({fromMs:Int64})
          AND Model != ''
        GROUP BY Model
        ORDER BY SpanCount DESC, Model ASC
        LIMIT {limit:UInt32}
      `,
      query_params: { fromMs, limit },
      format: "JSONEachRow",
    });

    const rows = modelUsageRowsSchema.parse(await result.json());
    return rows.map((row) => ({
      model: row.Model,
      spanCount: Number(row.SpanCount),
      lastSeenMs: Number(row.LastSeenMs),
    }));
  }

  async findRecentSpansByModels({
    authorization,
    models,
    fromMs,
    perModelLimit,
    limit,
  }: {
    authorization: Authorization;
    models: string[];
    fromMs: number;
    perModelLimit: number;
    limit: number;
  }): Promise<ModelSpanSampleRow[]> {
    if (models.length === 0) return [];

    const client = this.reader(authorization);
    // Narrow to candidate traces via Models, then scan their spans.
    const result = await client.query({
      query: `
        WITH candidate_traces AS (
          SELECT TraceId
          FROM trace_summaries
          WHERE ${tenantScope("OccurredAt")}
            AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND hasAny(Models, {models:Array(String)})
          GROUP BY TraceId
          ORDER BY max(OccurredAt) DESC
          LIMIT {candidatePool:UInt32}
        )
        SELECT
          TraceId,
          SpanId,
          ${MODEL_ATTR_SELECT} AS Model,
          argMax(SpanName, UpdatedAt) AS SpanName,
          argMax(SpanAttributes['gen_ai.usage.input_tokens'], UpdatedAt) AS InputTokensRaw,
          argMax(SpanAttributes['gen_ai.usage.prompt_tokens'], UpdatedAt) AS PromptTokensRaw,
          argMax(SpanAttributes['gen_ai.usage.output_tokens'], UpdatedAt) AS OutputTokensRaw,
          argMax(SpanAttributes['gen_ai.usage.completion_tokens'], UpdatedAt) AS CompletionTokensRaw,
          argMax(SpanAttributes['gen_ai.usage.cache_read.input_tokens'], UpdatedAt) AS CacheReadTokensRaw,
          argMax(SpanAttributes['gen_ai.usage.cache_creation.input_tokens'], UpdatedAt) AS CacheCreationTokensRaw,
          argMax(SpanAttributes['gen_ai.usage.cache_creation_1h.input_tokens'], UpdatedAt) AS CacheCreation1hTokensRaw,
          argMax(toUnixTimestamp64Milli(StartTime), UpdatedAt) AS StartTimeMs,
          (InputTokensRaw != '' OR PromptTokensRaw != ''
            OR OutputTokensRaw != '' OR CompletionTokensRaw != '') AS HasTokens
        FROM ${TABLE_NAME}
        WHERE ${tenantScope("StartTime")}
          AND StartTime >= fromUnixTimestamp64Milli({fromMs:Int64})
          AND TraceId IN (SELECT TraceId FROM candidate_traces)
          AND Model IN {models:Array(String)}
        GROUP BY TraceId, SpanId, Model
        ORDER BY HasTokens DESC, StartTimeMs DESC
        LIMIT {perModelLimit:UInt32} BY Model
        LIMIT {limit:UInt32}
      `,
      query_params: {
        models,
        fromMs,
        perModelLimit,
        limit,
        candidatePool: SAMPLE_CANDIDATE_TRACE_POOL,
      },
      format: "JSONEachRow",
    });

    const rows = modelSpanSampleQueryRowsSchema.parse(await result.json());
    return rows.map(mapModelSpanSampleRow);
  }

  private toClickHouseRecord(span: SpanInsertData): ClickHouseSpanWriteRecord {
    const serviceNameAny =
      span.spanAttributes["service.name"] ?? span.resourceAttributes["service.name"];
    const serviceName = typeof serviceNameAny === "string" ? serviceNameAny : "unknown";

    return {
      ProjectionId: span.id,
      TenantId: span.tenantId,
      TraceId: span.traceId,
      SpanId: span.spanId,
      ParentSpanId: span.parentSpanId,
      ParentTraceId: span.parentTraceId,
      ParentIsRemote: span.parentIsRemote,
      Sampled: span.sampled,
      StartTime: new Date(span.startTimeUnixMs),
      EndTime: new Date(span.endTimeUnixMs),
      DurationMs: Math.round(span.durationMs),
      SpanName: span.name,
      SpanKind: span.kind,
      ServiceName: serviceName,
      ResourceAttributes: serializeAttributes(span.resourceAttributes),
      SpanAttributes: serializeAttributes(span.spanAttributes),
      StatusCode: span.statusCode,
      StatusMessage: span.statusMessage,
      ScopeName: span.instrumentationScope.name,
      ScopeVersion: span.instrumentationScope.version ?? null,
      "Events.Timestamp": span.events.map((e) => new Date(e.timeUnixMs)),
      "Events.Name": span.events.map((e) => e.name),
      "Events.Attributes": span.events.map((e) => serializeAttributes(e.attributes)),
      "Links.TraceId": span.links.map((l) => l.traceId),
      "Links.SpanId": span.links.map((l) => l.spanId),
      "Links.Attributes": span.links.map((l) => serializeAttributes(l.attributes)),
      DroppedAttributesCount: 0,
      DroppedEventsCount: 0,
      DroppedLinksCount: 0,
      Cost: span.cost,
      NonBilledCost: span.nonBilledCost,
      CreatedAt: new Date(),
      UpdatedAt: new Date(),
      _retention_days: span.retentionDays ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    } satisfies ClickHouseSpanWriteRecord;
  }

  static mapSpanSummaryRow(row: SpanSummaryQueryRow): SpanSummaryRow {
    const explicitCost = parseAttrNumber(row.Cost);
    const inputTokens = parseAttrNumber(row.InputTokens);
    const outputTokens = parseAttrNumber(row.OutputTokens);
    const cacheReadTokens = parseAttrNumber(row.CacheReadTokens);
    const cacheCreationTokens = parseAttrNumber(row.CacheCreationTokens);

    // Some SDKs emit `gen_ai.usage.cost = 0` meaning "unknown", so any
    // non-positive explicit cost counts as absent and the computed cost runs.
    let cost = explicitCost !== null && explicitCost > 0 ? explicitCost : null;
    if (cost === null) {
      const computed = computeSummaryRowCost({ row, inputTokens, outputTokens });
      cost = computed > 0 ? computed : null;
    }

    return {
      spanId: row.SpanId,
      parentSpanId: row.ParentSpanId,
      spanName: row.SpanName,
      durationMs: Number(row.DurationMs),
      statusCode: row.StatusCode,
      spanType: row.SpanType || null,
      toolName: row.ToolName || null,
      requestId: row.RequestId || null,
      querySource: row.QuerySource || null,
      toolUseId: row.ToolUseId || null,
      model: row.Model || null,
      cost,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      startTimeMs: Number(row.StartTimeMs),
      updatedAtMs: Number(row.UpdatedAtMs),
    };
  }
}
