import type { Authorization } from "@langwatch/authorization";
import {
  type AuthorizedClickHouse,
  type ClickHouseQueryClient,
  DEFAULT_PARTITION_WINDOW_MS,
  type IdBoundOptions,
  RESOLVER_RECENT_WINDOW_MS,
  tenantScopeKey,
  type WindowFallback,
} from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  type Condition,
  cond,
  type Expression,
  fn,
  param,
  tenantScope as builtTenantScope,
} from "@langwatch/clickhouse-client/builder";
import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { ATTR_KEYS } from "@langwatch/span-normalisation";
import { nowInstant, toDate } from "@langwatch/time";
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
  type OwnedSpan,
} from "@langwatch/trace-contract";

import {
  braidedOwnerOf,
  readsOwnersSpans,
  singleSpanOwnerRead,
} from "../../features/braid/rules/braided-span-owner.rules.ts";
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

import { storedSpans } from "./clickhouse.stored-spans.table.ts";
import { traceSummaries } from "./clickhouse.trace-summaries.table.ts";
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
  type PagedOwnedSpans,
  type SpanLangwatchSignalsRow,
  type TraceViewRead,
  type TraceEventRollupParams,
  LANGWATCH_SIGNAL_BUCKETS,
  MAX_DERIVATION_SPANS,
  MAX_EVENT_NAMES_PER_TRACE,
  MAX_LIGHT_SPAN_READ_ROWS,
  MAX_STORED_TRACE_SPAN_ROWS,
  type SingleSpanParams,
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
 * The full-span projection minus the `Events.*` / `Links.*` nested columns, for internal
 * derivation consumers that read scalar span/resource attributes, never events or links.
 */
const DERIVATION_SPAN_SELECTION = {
  SpanId: storedSpans.SpanId,
  TraceId: storedSpans.TraceId,
  TenantId: storedSpans.TenantId,
  ParentSpanId: storedSpans.ParentSpanId,
  ParentTraceId: storedSpans.ParentTraceId,
  ParentIsRemote: storedSpans.ParentIsRemote,
  Sampled: storedSpans.Sampled,
  StartTimeMs: fn.toUnixTimestamp64Milli(storedSpans.StartTime),
  EndTimeMs: fn.toUnixTimestamp64Milli(storedSpans.EndTime),
  DurationMs: storedSpans.DurationMs,
  SpanName: storedSpans.SpanName,
  SpanKind: storedSpans.SpanKind,
  ResourceAttributes: storedSpans.ResourceAttributes,
  SpanAttributes: storedSpans.SpanAttributes,
  StatusCode: storedSpans.StatusCode,
  StatusMessage: storedSpans.StatusMessage,
  ScopeName: storedSpans.ScopeName,
  ScopeVersion: storedSpans.ScopeVersion,
  Cost: storedSpans.Cost,
  NonBilledCost: storedSpans.NonBilledCost,
};

/** The full-span projection every reader returning `Span[]` selects, defined once. */
const FULL_SPAN_SELECTION = {
  ...DERIVATION_SPAN_SELECTION,
  Events_Timestamp: fn.arrayMap(
    (at) => fn.toUnixTimestamp64Milli(at),
    storedSpans["Events.Timestamp"],
  ),
  Events_Name: storedSpans["Events.Name"],
  Events_Attributes: storedSpans["Events.Attributes"],
  Links_TraceId: storedSpans["Links.TraceId"],
  Links_SpanId: storedSpans["Links.SpanId"],
  Links_Attributes: storedSpans["Links.Attributes"],
};

/** The stored-attribute projection the prompt playground reads. */
const STORED_SPAN_SELECTION = {
  SpanId: storedSpans.SpanId,
  TraceId: storedSpans.TraceId,
  ParentSpanId: storedSpans.ParentSpanId,
  SpanName: storedSpans.SpanName,
  SpanAttributes: storedSpans.SpanAttributes,
  StartTimeMs: fn.toUnixTimestamp64Milli(storedSpans.StartTime),
  EndTimeMs: fn.toUnixTimestamp64Milli(storedSpans.EndTime),
  DurationMs: storedSpans.DurationMs,
  StatusCode: storedSpans.StatusCode,
  StatusMessage: storedSpans.StatusMessage,
};

/**
 * One trace's latest full spans under the proof: braided, the owners' spans under their
 * conditions beside a bare election; otherwise the reader's own windows (ADR-201 §5).
 */
function fullSpansStatement({
  authorization,
  braided,
  traceId,
  limit,
}: {
  authorization: Authorization;
  braided: boolean;
  traceId: string;
  limit: number;
}) {
  const scope = builtTenantScope.fromProof({ authorization, reads: braided ? "spans" : "traces" });
  const read = clickhouseRead({ scope }).from(storedSpans);
  return (braided ? read.braided({ heldTrace: { traceId } }) : read.withinWindows())
    .select(FULL_SPAN_SELECTION)
    .where(({ idBound }) => idBound(storedSpans.TraceId, traceId))
    .latestVersion()
    .orderBy("StartTimeMs", "ASC")
    .limit(limit)
    .settings(SINGLE_TRACE_READ_SETTINGS)
    .build();
}

/** One trace's latest spans with their attributes as stored, in the reader's own windows. */
function storedSpansStatement({
  authorization,
  traceId,
  limit,
}: {
  authorization: Authorization;
  traceId: string;
  limit: number;
}) {
  return clickhouseRead({ scope: builtTenantScope.fromProof({ authorization, reads: "traces" }) })
    .from(storedSpans)
    .withinWindows()
    .select(STORED_SPAN_SELECTION)
    .where(({ idBound }) => idBound(storedSpans.TraceId, traceId))
    .latestVersion()
    .orderBy("StartTimeMs", "ASC")
    .limit(limit)
    .settings(SINGLE_TRACE_READ_SETTINGS)
    .build();
}

/**
 * One span's latest version under the proof. Braided: one per project holding the span id, the
 * condition on the outer select beside a bare election, so the caller keeps the owner's row
 * (ADR-201 §3); otherwise the newest version in the reader's own windows.
 */
function singleSpanStatement({
  authorization,
  braided,
  traceId,
  spanId,
  selection,
}: {
  authorization: Authorization;
  braided: boolean;
  traceId: string;
  spanId: string;
  selection: typeof FULL_SPAN_SELECTION | typeof DERIVATION_SPAN_SELECTION;
}) {
  const scope = builtTenantScope.fromProof({ authorization, reads: braided ? "spans" : "traces" });
  const read = clickhouseRead({ scope }).from(storedSpans);
  const span = (braided ? read.braided({ heldTrace: { traceId } }) : read.withinWindows())
    .select(selection)
    .where(({ idBound }) => idBound(storedSpans.TraceId, traceId))
    .where(({ eq }) => eq(storedSpans.SpanId, spanId));
  return (braided ? span.latestVersion() : span.orderBy(storedSpans.UpdatedAt, "DESC").limit(1))
    .settings(SINGLE_SPAN_FETCH_SETTINGS)
    .build();
}

/**
 * Per-query memory ceiling for the single-trace full-attribute reads below.
 */
const SINGLE_TRACE_READ_MAX_MEMORY_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
const SINGLE_TRACE_READ_SETTINGS = {
  // ClickHouse settings are string-typed over the wire.
  max_memory_usage: String(SINGLE_TRACE_READ_MAX_MEMORY_BYTES),
} as const;

/**
 * Single-span fetches read eagerly: ClickHouse 25.10's lazy `Events.Attributes` read with
 * `max_rows_to_read=1` raised ATTEMPT_TO_READ_AFTER_EOF on intact parts, and an eager read never
 * enters that reader. The tenant, trace and span key prefix keeps the eager read small.
 */
const SINGLE_SPAN_FETCH_SETTINGS = {
  ...SINGLE_TRACE_READ_SETTINGS,
  query_plan_optimize_lazy_materialization: "0",
} as const;

const attribute = (key: string) => fn.mapGet(storedSpans.SpanAttributes, key);
/** The first attribute when it is not empty, else the second. */
const attributeOr = (key: string, fallback: string) =>
  fn.coalesce(fn.nullIf(attribute(key), ""), attribute(fallback));

/** A span's OTel resource and scope, and its start for ordering: no heavy attribute is read. */
const RESOURCE_SPAN_SELECTION = {
  SpanId: storedSpans.SpanId,
  ParentSpanId: storedSpans.ParentSpanId,
  StartTimeMs: fn.toUnixTimestamp64Milli(storedSpans.StartTime),
  ResourceAttributes: storedSpans.ResourceAttributes,
  ScopeName: storedSpans.ScopeName,
  ScopeVersion: storedSpans.ScopeVersion,
};

/** Light projection for span tree shape, avoiding heavy nested columns. */
const SUMMARY_SPAN_SELECTION = {
  SpanId: storedSpans.SpanId,
  ParentSpanId: storedSpans.ParentSpanId,
  SpanName: storedSpans.SpanName,
  DurationMs: storedSpans.DurationMs,
  StatusCode: storedSpans.StatusCode,
  SpanType: attributeOr("langwatch.span.type", "span.type"),
  ToolName: attributeOr("gen_ai.tool.name", "tool_name"),
  RequestId: attribute("request_id"),
  QuerySource: attribute("query_source"),
  ToolUseId: attributeOr("tool_use_id", "gen_ai.tool.call.id"),
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
  InputImageTokens: attribute("gen_ai.usage.input_image_tokens"),
  OutputImageTokens: attribute("gen_ai.usage.output_image_tokens"),
  CustomInputRate: attribute("langwatch.model.inputCostPerToken"),
  CustomOutputRate: attribute("langwatch.model.outputCostPerToken"),
  CustomCacheReadRate: attribute("langwatch.model.cacheReadCostPerToken"),
  CustomCacheCreationRate: attribute("langwatch.model.cacheCreationCostPerToken"),
  CustomCacheCreation1hRate: attribute("langwatch.model.cacheCreation1hCostPerToken"),
  LwSpanCost: attribute("langwatch.span.cost"),
  StartTimeMs: fn.toUnixTimestamp64Milli(storedSpans.StartTime),
  UpdatedAtMs: fn.toUnixTimestamp64Milli(storedSpans.UpdatedAt),
};

/** The trace view's proof scope: a braided read asks for spans, any other for traces. */
function traceScope({
  authorization,
  braided,
}: {
  authorization: Authorization;
  braided: boolean;
}) {
  return builtTenantScope.fromProof({ authorization, reads: braided ? "spans" : "traces" });
}

/** A trace's spans under the proof: braided, the owners' under their conditions; else windows. */
function traceSpansFrom({
  scope,
  braided,
  traceId,
}: {
  scope: ReturnType<typeof traceScope>;
  braided: boolean;
  traceId: string;
}) {
  const read = clickhouseRead({ scope }).from(storedSpans);
  return braided ? read.braided({ heldTrace: { traceId } }) : read.withinWindows();
}

/** One trace's latest spans in light columns; a braided read names each row's owner. */
function lightSpansStatement({
  authorization,
  braided,
  traceId,
  selection,
}: {
  authorization: Authorization;
  braided: boolean;
  traceId: string;
  selection: typeof RESOURCE_SPAN_SELECTION | typeof SUMMARY_SPAN_SELECTION;
}) {
  return traceSpansFrom({ scope: traceScope({ authorization, braided }), braided, traceId })
    .select(braided ? { ...selection, TenantId: storedSpans.TenantId } : selection)
    .where(({ idBound }) => idBound(storedSpans.TraceId, traceId))
    .latestVersion()
    .orderBy("StartTimeMs", "ASC")
    .limit(MAX_LIGHT_SPAN_READ_ROWS)
    .build();
}

/** A live poll's latest full spans: bounded from below by its own since-time, not the id index. */
function spansSinceStatement({
  authorization,
  braided,
  traceId,
  sinceStartTimeMs,
}: {
  authorization: Authorization;
  braided: boolean;
  traceId: string;
  sinceStartTimeMs: number;
}) {
  return traceSpansFrom({ scope: traceScope({ authorization, braided }), braided, traceId })
    .select(FULL_SPAN_SELECTION)
    .where(({ and, eq, gt }) =>
      and(eq(storedSpans.TraceId, traceId), gt(storedSpans.StartTime, sinceStartTimeMs)),
    )
    .latestVersion()
    .orderBy(storedSpans.StartTime, "ASC")
    .limit(MAX_DERIVATION_SPANS)
    .build();
}

/** The earliest OccurredAt of a trace's summary in the reader's windows, from `sinceMs` on. */
function traceOccurredAtStatement({
  authorization,
  traceId,
  sinceMs,
}: {
  authorization: Authorization;
  traceId: string;
  sinceMs?: number;
}) {
  return clickhouseRead({ scope: builtTenantScope.fromProof({ authorization, reads: "traces" }) })
    .from(traceSummaries)
    .withinWindows()
    .select({ occurredAtMs: fn.toUnixTimestamp64Milli(fn.min(traceSummaries.OccurredAt)) })
    .where(({ and, eq, gte }) =>
      sinceMs === undefined
        ? eq(traceSummaries.TraceId, traceId)
        : and(eq(traceSummaries.TraceId, traceId), gte(traceSummaries.OccurredAt, sinceMs)),
    )
    .build();
}

/**
 * One row per event of each span's latest version: the election runs before the events unroll,
 * so no event of a stale version is read. With a span id and no braid, that span's newest version
 * by UpdatedAt, as a single-span read takes it.
 */
function spanEventsStatement({
  authorization,
  braided,
  traceId,
  spanId,
  newestFirst,
  withoutExceptions = false,
  limit,
  settings,
}: {
  authorization: Authorization;
  braided: boolean;
  traceId: string;
  spanId?: string;
  newestFirst: boolean;
  withoutExceptions?: boolean;
  limit?: number;
  settings?: typeof SINGLE_SPAN_FETCH_SETTINGS;
}) {
  const scope = traceScope({ authorization, braided });
  let spans = traceSpansFrom({ scope, braided, traceId })
    .select({
      TenantId: storedSpans.TenantId,
      TraceId: storedSpans.TraceId,
      SpanId: storedSpans.SpanId,
      SpanEvents: fn.arrayZip(
        storedSpans["Events.Timestamp"],
        storedSpans["Events.Name"],
        storedSpans["Events.Attributes"],
      ),
    })
    .where(({ idBound }) => idBound(storedSpans.TraceId, traceId));
  if (spanId !== undefined) spans = spans.where(({ eq }) => eq(storedSpans.SpanId, spanId));
  const newestOnly = spanId !== undefined && !braided;
  const latest = (
    newestOnly ? spans.orderBy(storedSpans.UpdatedAt, "DESC").limit(1) : spans.latestVersion()
  ).as("latest");
  const events = clickhouseRead({ scope })
    .from(latest)
    .select({
      TenantId: latest.TenantId,
      TraceId: latest.TraceId,
      SpanId: latest.SpanId,
      Event: fn.arrayJoin(latest.SpanEvents),
    })
    .as("events");
  const eventTimestamp = fn.tupleElement(events.Event, "0");
  const eventName = fn.tupleElement(events.Event, "1");
  let statement = clickhouseRead({ scope })
    .from(events)
    .select({
      event_id: events.SpanId,
      trace_id: events.TraceId,
      project_id: events.TenantId,
      started_at: fn.toUnixTimestamp64Milli(eventTimestamp),
      event_type: eventName,
      attributes: fn.tupleElement(events.Event, "2"),
    });
  if (withoutExceptions) {
    statement = statement.where(({ ne }) => ne(eventName, param.string("exception")));
  }
  statement = statement.orderBy(eventTimestamp, newestFirst ? "DESC" : "ASC");
  if (limit !== undefined) statement = statement.limit(limit);
  if (settings !== undefined) statement = statement.settings(settings);
  return statement.build();
}

/** The StartTime range a trace's spans lie in, as epoch milliseconds. */
const SPAN_RANGE_SELECTION = {
  FromMs: fn.toUnixTimestamp64Milli(fn.min(storedSpans.StartTime)),
  ToMs: fn.toUnixTimestamp64Milli(fn.max(storedSpans.StartTime)),
};

/**
 * A page's count and range. Braided, each owner span's latest version under its braid's
 * condition, one per project holding a span id, with the projects counted (ADR-201 §8).
 */
function spanRangeStatement({
  authorization,
  braided,
  traceId,
}: {
  authorization: Authorization;
  braided: boolean;
  traceId: string;
}) {
  const read = traceSpansFrom({ scope: traceScope({ authorization, braided }), braided, traceId });
  if (!braided) {
    return read
      .select({ Total: fn.countDistinct(storedSpans.SpanId), ...SPAN_RANGE_SELECTION })
      .where(({ idBound }) => idBound(storedSpans.TraceId, traceId))
      .having(({ gt }) => gt(fn.count(), 0))
      .build();
  }
  return read
    .select({
      Total: fn.countDistinct(fn.tuple(storedSpans.TenantId, storedSpans.SpanId)),
      Tenants: fn.groupUniqArray(storedSpans.TenantId),
      ...SPAN_RANGE_SELECTION,
    })
    .where(({ idBound }) => idBound(storedSpans.TraceId, traceId))
    .latestVersion()
    .having(({ gt }) => gt(fn.count(), 0))
    .build();
}

/** One page of a trace's latest full spans, bounded by the exact range the range read found. */
function spanPageStatement({
  authorization,
  braided,
  traceId,
  fromMs,
  toMs,
  limit,
  offset,
}: {
  authorization: Authorization;
  braided: boolean;
  traceId: string;
  fromMs: number;
  toMs: number;
  limit: number;
  offset: number;
}) {
  return traceSpansFrom({ scope: traceScope({ authorization, braided }), braided, traceId })
    .select(FULL_SPAN_SELECTION)
    .where(({ and, eq, gte, lte }) =>
      and(
        eq(storedSpans.TraceId, traceId),
        gte(storedSpans.StartTime, fromMs),
        lte(storedSpans.StartTime, toMs),
      ),
    )
    .latestVersion()
    .orderBy(storedSpans.StartTime, "ASC")
    .limit(limit)
    .offset(offset)
    .build();
}

/**
 * One row per (tenant, trace, event name) for a page of traces, first-recorded name first. A
 * trace is its tenant and id together: a proof may fence tenants sharing a trace id.
 */
function traceEventRollupStatement({
  authorization,
  traceIds,
  fromMs,
  toMs,
}: {
  authorization: Authorization;
  traceIds: string[];
  fromMs: number;
  toMs: number;
}) {
  const scope = builtTenantScope.fromProof({ authorization, reads: "traces" });
  const latest = clickhouseRead({ scope })
    .from(storedSpans)
    .withinWindows()
    .select({
      TenantId: storedSpans.TenantId,
      TraceId: storedSpans.TraceId,
      SpanEvents: fn.arrayZip(storedSpans["Events.Timestamp"], storedSpans["Events.Name"]),
    })
    .where(({ and, gte, lte, oneOf }) =>
      and(
        oneOf(storedSpans.TraceId, param.strings(traceIds)),
        gte(storedSpans.StartTime, fromMs),
        lte(storedSpans.StartTime, toMs),
      ),
    )
    // Outside the election, as main's: a latest version without events drops its span.
    .where(() => fn.notEmpty(storedSpans["Events.Name"]), { inElection: false })
    .latestVersion()
    .as("latest");
  const events = clickhouseRead({ scope })
    .from(latest)
    .select({
      TenantId: latest.TenantId,
      TraceId: latest.TraceId,
      Event: fn.arrayJoin(latest.SpanEvents),
    })
    .as("events");
  const eventName = fn.tupleElement(events.Event, "1");
  const names = clickhouseRead({ scope })
    .from(events)
    .select({
      TenantId: events.TenantId,
      TraceId: events.TraceId,
      name: eventName,
      nameCount: fn.count(),
      firstTimestamp: fn.toUnixTimestamp64Milli(fn.min(fn.tupleElement(events.Event, "0"))),
    })
    .groupBy(events.TenantId, events.TraceId, eventName)
    .as("names");
  const perTrace = { partitionBy: [names.TenantId, names.TraceId] };
  return clickhouseRead({ scope })
    .from(names)
    .select({
      TenantId: names.TenantId,
      TraceId: names.TraceId,
      name: names.name,
      nameCount: names.nameCount,
      firstTimestamp: names.firstTimestamp,
      totalCount: fn.over(fn.sum(names.nameCount), perTrace),
      distinctCount: fn.over(fn.count(), perTrace),
    })
    .orderBy(names.TenantId, "ASC")
    .orderBy(names.TraceId, "ASC")
    .orderBy(names.firstTimestamp, "ASC")
    .orderBy(names.name, "ASC")
    .limitBy(MAX_EVENT_NAMES_PER_TRACE, names.TenantId, names.TraceId)
    .build();
}

/** A recent span per model sample, from candidate traces whose summaries name the models. */
function recentModelSpansStatement({
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
}) {
  const model = attributeOr("gen_ai.response.model", "gen_ai.request.model");
  const modelList = param.strings(models);
  const latest = <V, T extends string>(value: Expression<V, T>) =>
    fn.argMax(value, storedSpans.UpdatedAt);
  const inputTokens = latest(attribute("gen_ai.usage.input_tokens"));
  const promptTokens = latest(attribute("gen_ai.usage.prompt_tokens"));
  const outputTokens = latest(attribute("gen_ai.usage.output_tokens"));
  const completionTokens = latest(attribute("gen_ai.usage.completion_tokens"));
  return clickhouseRead({ scope: builtTenantScope.fromProof({ authorization, reads: "traces" }) })
    .from(storedSpans)
    .withinWindows()
    .with("candidate_traces", (sub) =>
      sub
        .from(traceSummaries)
        .withinWindows()
        .select({ TraceId: traceSummaries.TraceId })
        .where(({ and, gte }) =>
          and(gte(traceSummaries.OccurredAt, fromMs), fn.hasAny(traceSummaries.Models, modelList)),
        )
        .groupBy(traceSummaries.TraceId)
        .orderBy(fn.max(traceSummaries.OccurredAt), "DESC")
        .limit(SAMPLE_CANDIDATE_TRACE_POOL),
    )
    .select(({ ne, or }) => ({
      TraceId: storedSpans.TraceId,
      SpanId: storedSpans.SpanId,
      Model: model,
      LatestSpanName: latest(storedSpans.SpanName),
      InputTokensRaw: inputTokens,
      PromptTokensRaw: promptTokens,
      OutputTokensRaw: outputTokens,
      CompletionTokensRaw: completionTokens,
      CacheReadTokensRaw: latest(attribute("gen_ai.usage.cache_read.input_tokens")),
      CacheCreationTokensRaw: latest(attribute("gen_ai.usage.cache_creation.input_tokens")),
      CacheCreation1hTokensRaw: latest(attribute("gen_ai.usage.cache_creation_1h.input_tokens")),
      StartTimeMs: latest(fn.toUnixTimestamp64Milli(storedSpans.StartTime)),
      HasTokens: or(
        ne(inputTokens, ""),
        ne(promptTokens, ""),
        ne(outputTokens, ""),
        ne(completionTokens, ""),
      ),
    }))
    .where(({ and, gte, oneOf }) =>
      and(
        gte(storedSpans.StartTime, fromMs),
        oneOf(storedSpans.TraceId, { cte: "candidate_traces" }),
        oneOf(model, modelList),
      ),
    )
    .groupBy(storedSpans.TraceId, storedSpans.SpanId, model)
    .orderBy("HasTokens", "DESC")
    .orderBy("StartTimeMs", "DESC")
    .limitBy(perModelLimit, model)
    .limit(limit)
    .build();
}

/** Each model's span count since a time; `uniq` so a span's stored versions count once. */
function modelUsageStatement({
  authorization,
  fromMs,
  limit,
}: {
  authorization: Authorization;
  fromMs: number;
  limit: number;
}) {
  const model = attributeOr("gen_ai.response.model", "gen_ai.request.model");
  return clickhouseRead({ scope: builtTenantScope.fromProof({ authorization, reads: "traces" }) })
    .from(storedSpans)
    .withinWindows()
    .select({
      Model: model,
      SpanCount: fn.uniq(storedSpans.TraceId, storedSpans.SpanId),
      LastSeenMs: fn.toUnixTimestamp64Milli(fn.max(storedSpans.StartTime)),
    })
    .where(({ and, gte, ne }) => and(gte(storedSpans.StartTime, fromMs), ne(model, "")))
    .groupBy(model)
    .orderBy("SpanCount", "DESC")
    .orderBy("Model", "ASC")
    .limit(limit)
    .build();
}

type SpanKeys = Expression<readonly string[], "span_keys">;

const keyStartsWith = (prefix: string) => (keys: SpanKeys) =>
  fn.arrayExists((key) => fn.startsWith(key, prefix), keys);

/** Per-bucket key matchers for LangWatch signals; order must match LANGWATCH_SIGNAL_BUCKETS. */
const SIGNAL_BUCKET_PREDICATES: Record<
  LangwatchSignalBucket,
  (keys: SpanKeys) => Condition<"span_keys">
> = {
  prompt: keyStartsWith("langwatch.prompt."),
  scenario: (keys) =>
    fn.arrayExists(
      (key) => cond.or(fn.startsWith(key, "langwatch.scenario."), cond.eq(key, "scenario.run_id")),
      keys,
    ),
  user: (keys) =>
    fn.arrayExists(
      (key) => cond.or(cond.eq(key, "langwatch.user_id"), fn.startsWith(key, "langwatch.user.")),
      keys,
    ),
  thread: (keys) =>
    fn.arrayExists(
      (key) =>
        cond.or(
          cond.eq(key, "gen_ai.conversation.id"),
          cond.eq(key, "langgraph.thread_id"),
          fn.startsWith(key, "langwatch.thread."),
        ),
      keys,
    ),
  evaluation: keyStartsWith("langwatch.evaluation"),
  rag: keyStartsWith("langwatch.rag."),
  metadata: keyStartsWith("langwatch.metadata."),
  genai: keyStartsWith("gen_ai."),
};

/**
 * A trace's spans' LangWatch signals from their latest attribute keys only, never the heavy
 * values. Ordered before the cap so a runaway trace always yields its earliest-starting spans.
 */
function langwatchSignalsStatement({
  authorization,
  braided,
  traceId,
}: {
  authorization: Authorization;
  braided: boolean;
  traceId: string;
}) {
  const scope = traceScope({ authorization, braided });
  const spanKeys = traceSpansFrom({ scope, braided, traceId })
    .select({
      TenantId: storedSpans.TenantId,
      SpanId: storedSpans.SpanId,
      keys: fn.mapKeys(storedSpans.SpanAttributes),
    })
    .where(({ idBound }) => idBound(storedSpans.TraceId, traceId))
    .latestVersion()
    .orderBy(storedSpans.StartTime, "ASC")
    .limit(MAX_LIGHT_SPAN_READ_ROWS)
    .as("span_keys");
  const signals = fn.arrayFilter(
    (signal) => cond.ne(signal, ""),
    fn.array(
      ...LANGWATCH_SIGNAL_BUCKETS.map((bucket) =>
        fn.if(SIGNAL_BUCKET_PREDICATES[bucket](spanKeys.keys), param.string(bucket), ""),
      ),
    ),
  );
  const selection = { SpanId: spanKeys.SpanId, Signals: signals };
  return clickhouseRead({ scope })
    .from(spanKeys)
    .select(braided ? { TenantId: spanKeys.TenantId, ...selection } : selection)
    .build();
}

/**
 * Candidate trace pool size for model-cost sample read.
 */
const SAMPLE_CANDIDATE_TRACE_POOL = 500;

const numeric = z.union([z.number(), z.string()]);

const modelSpanSampleQueryRowSchema = z.looseObject({
  TraceId: chString,
  SpanId: chString,
  LatestSpanName: chString,
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
    spanName: row.LatestSpanName,
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

/** Spans mapped from full rows; under braids each owner's span names its owner. */
function ownedSpansOf({
  rows,
  authorization,
  braided,
}: {
  rows: Parameters<typeof mapChRowToNormalized>[0][];
  authorization: Authorization;
  braided: boolean;
}): OwnedSpan[] {
  const normalized = rows.map(mapChRowToNormalized);
  const spans = mapNormalizedSpansToSpans(normalized);
  if (!braided) return spans;
  return spans.map((span, index) => ({
    ...span,
    ...braidedOwnerOf({ authorization, tenantId: normalized[index]?.tenantId }),
  }));
}

/**
 * Gather {@link traceEventRollupStatement}'s flat rows into one rollup per trace,
 * keyed by {@link listedTraceKey} so two tenants holding the same trace id
 * each keep their own rollup.
 */
function toTraceEventRollups(rows: TraceEventRollupRow[]): Record<string, TraceEventRollup> {
  const rollups: Record<string, TraceEventRollup> = {};
  for (const row of rows) {
    const key = listedTraceKey({
      projectId: row.TenantId,
      traceId: row.TraceId,
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

const spanSummaryQueryRowSchema = z.looseObject({
  TenantId: chString.optional(),
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
  // `gen_ai.usage.cost`; `Cost` is a stored column's name, which an alias may not reuse.
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

const traceEventRollupRowSchema = z.looseObject({
  TenantId: chString,
  TraceId: chString,
  name: chString,
  nameCount: numeric,
  firstTimestamp: numeric,
  totalCount: numeric,
  distinctCount: numeric,
});

const traceEventRollupRowsSchema = z.array(traceEventRollupRowSchema);

type TraceEventRollupRow = z.infer<typeof traceEventRollupRowSchema>;

const resourceInfoRowSchema = z.looseObject({
  TenantId: chString.optional(),
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

const signalsRowSchema = z.looseObject({
  TenantId: chString.optional(),
  SpanId: chString,
  Signals: z.array(chString),
});

const signalsRowsSchema = z.array(signalsRowSchema);

/** A trace's distinct span count, the StartTime range its spans lie in (epoch ms), and, under
 * braids, the projects the count holds spans of. */
const spanRangeRowsSchema = z.array(
  z.looseObject({
    Total: numeric,
    FromMs: numeric,
    ToMs: numeric,
    Tenants: z.array(chString).optional(),
  }),
);

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
    reader: Pick<ClickHouseQueryClient, "read">;
  }): SpanStorageClickHouseRepository {
    return new SpanStorageClickHouseRepository(deps);
  }

  constructor(
    private readonly deps: {
      resolveClient: ClickHouseClientResolver;
      clickhouse: AuthorizedClickHouse;
      reader: Pick<ClickHouseQueryClient, "read">;
    },
  ) {}

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
    reads,
  }: {
    authorization: Authorization;
    traceId: string;
    limit?: number;
  } & OccurredAtHint &
    TraceViewRead): Promise<OwnedSpan[]> {
    // Hard ceiling, applied unconditionally: a leaked trace_id with a huge span
    // count can never load the pipeline through this path, regardless of caller.
    const effectiveLimit = SpanStorageRepository.clampSpanReadLimit(limit);
    const braided = readsOwnersSpans({ authorization, reads });

    try {
      return await this.readTraceSpans<OwnedSpan[]>(
        { authorization, traceId, occurredAtMs },
        async (idBound) => {
          const result = await this.deps.reader.read({
            statement: fullSpansStatement({
              authorization,
              braided,
              traceId,
              limit: effectiveLimit,
            }),
            table: storedSpans.$table.name,
            idBound,
          });

          const rows = fullSpanRowsSchema.parse(result.rows);
          return ownedSpansOf({ rows, authorization, braided });
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
    reads,
  }: {
    authorization: Authorization;
    traceId: string;
    limit?: number;
  } & OccurredAtHint &
    TraceViewRead): Promise<NormalizedSpan[]> {
    // Hard ceiling so even a leaked trace_id can never load the pipeline.
    const effectiveLimit = SpanStorageRepository.clampSpanReadLimit(limit);
    const braided = readsOwnersSpans({ authorization, reads });

    // The ±window hint prunes partitions on the happy path; the empty-result
    // fallback covers a stale/wrong hint. The window (±2 days) dwarfs any real
    // trace duration, so a derivation read can't realistically split across it.
    try {
      return await this.readTraceSpans<NormalizedSpan[]>(
        { authorization, traceId, occurredAtMs },
        async (idBound) => {
          const result = await this.deps.reader.read({
            statement: fullSpansStatement({
              authorization,
              braided,
              traceId,
              limit: effectiveLimit,
            }),
            table: storedSpans.$table.name,
            idBound,
          });

          const rows = fullSpanRowsSchema.parse(result.rows);
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
        async (idBound) => {
          const result = await this.deps.reader.read({
            statement: storedSpansStatement({ authorization, traceId, limit: effectiveLimit }),
            table: storedSpans.$table.name,
            idBound,
          });

          return storedSpanRowsSchema.parse(result.rows).map(storedTraceSpanOf);
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
    ownerProjectId,
    occurredAtMs,
  }: SingleSpanParams): Promise<Span | null> {
    try {
      return await this.readTraceSpans<Span | null>(
        { authorization, traceId, occurredAtMs },
        async (idBound) => {
          const row = await this.fetchNormalizedSpanRow({
            authorization,
            traceId,
            spanId,
            ownerProjectId,
            idBound,
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

  /** One whole span as stored, unresolved, for a read that resolves its body under its owner. */
  async findNormalizedSpanByIds({
    authorization,
    traceId,
    spanId,
    ownerProjectId,
    occurredAtMs,
  }: SingleSpanParams): Promise<NormalizedSpan | null> {
    return this.readTraceSpans<NormalizedSpan | null>(
      { authorization, traceId, occurredAtMs },
      (idBound) =>
        this.fetchNormalizedSpanRow({ authorization, traceId, spanId, ownerProjectId, idBound }),
    );
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
      return await this.fetchNormalizedSpanRow({
        authorization,
        traceId,
        spanId,
        idBound: { occurredAtHint: occurredAtMs ?? null, fallback: "none" },
        // Derivation consumers lift scalar attributes only; the nested
        // Events/Links columns are both unused here and the source of the
        // `Attempt to read after eof` failures this read retries on.
        selection: DERIVATION_SPAN_SELECTION,
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

  /** One span's latest version, read eagerly ({@link SINGLE_SPAN_FETCH_SETTINGS}). */
  private async fetchNormalizedSpanRow({
    authorization,
    traceId,
    spanId,
    idBound,
    selection = FULL_SPAN_SELECTION,
    ownerProjectId,
  }: {
    authorization: Authorization;
    traceId: string;
    spanId: string;
    idBound: IdBoundOptions;
    selection?: typeof FULL_SPAN_SELECTION | typeof DERIVATION_SPAN_SELECTION;
    ownerProjectId?: string | undefined;
  }): Promise<NormalizedSpan | null> {
    const ownerRead = singleSpanOwnerRead({ authorization, ownerProjectId });
    if (ownerRead.kind === "unreadable") return null;
    const braided = ownerRead.kind === "braided";
    const result = await this.deps.reader.read({
      statement: singleSpanStatement({ authorization, braided, traceId, spanId, selection }),
      table: storedSpans.$table.name,
      idBound,
    });
    const rows = fullSpanRowsSchema.parse(result.rows);
    const row = braided
      ? rows.find((candidate) => candidate.TenantId === ownerRead.ownerProjectId)
      : rows[0];
    return row === undefined ? null : mapChRowToNormalized(row);
  }

  async findSpanResourcesByTraceId({
    authorization,
    traceId,
    occurredAtMs,
    reads,
  }: {
    authorization: Authorization;
    traceId: string;
  } & OccurredAtHint &
    TraceViewRead): Promise<SpanResourceInfo[]> {
    const braided = readsOwnersSpans({ authorization, reads });
    return this.readTraceSpans<SpanResourceInfo[]>(
      { authorization, traceId, occurredAtMs },
      async (idBound) => {
        // Light projection: only the resource/scope columns plus the bits needed for ordering.
        const result = await this.deps.reader.read({
          statement: lightSpansStatement({
            authorization,
            braided,
            traceId,
            selection: RESOURCE_SPAN_SELECTION,
          }),
          table: storedSpans.$table.name,
          idBound,
        });
        const rows = resourceInfoRowsSchema.parse(result.rows);

        return rows.map((row) => ({
          spanId: row.SpanId,
          parentSpanId: row.ParentSpanId,
          startTimeMs: row.StartTimeMs,
          resourceAttributes: ensureStringRecord(row.ResourceAttributes),
          scopeName: row.ScopeName ?? null,
          scopeVersion: row.ScopeVersion ?? null,
          ...(braided ? braidedOwnerOf({ authorization, tenantId: row.TenantId }) : {}),
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
    // ID_BOUND_SKIP: the not-ready hint resolver; the index path never runs it.
    const result = await this.deps.reader.read({
      statement: traceOccurredAtStatement({ authorization, traceId, sinceMs }),
      table: traceSummaries.$table.name,
    });
    const rows = occurredAtRowsSchema.parse(result.rows);
    const raw = rows[0]?.occurredAtMs;
    if (raw === null || raw === undefined) return undefined;
    // `min` over no matching rows yields the epoch default (0); treat that — and
    // any non-positive value — as "unknown" so the caller stays unbounded.
    const ms = typeof raw === "string" ? Number(raw) : raw;
    return Number.isFinite(ms) && ms > 0 ? ms : undefined;
  }

  /**
   * A single-trace stored_spans read's bound: the caller's time first; while the index is not
   * ready, the summary's OccurredAt as before; once ready, the span index, so spans stored before
   * their summary is projected are found too. Events reads never widen past the hint.
   */
  private spanBound(
    {
      authorization,
      traceId,
      occurredAtMs,
    }: { authorization: Authorization; traceId: string } & OccurredAtHint,
    fallback: WindowFallback,
  ): IdBoundOptions {
    return {
      occurredAtHint: occurredAtMs ?? null,
      fallback,
      resolveHint: () => this.resolveTraceOccurredAtMs({ authorization, traceId }),
    };
  }

  private readTraceEvents<T>(
    params: { authorization: Authorization; traceId: string } & OccurredAtHint,
    run: (idBound: IdBoundOptions) => Promise<T>,
  ): Promise<T> {
    return run(this.spanBound(params, "none"));
  }

  private readTraceSpans<T>(
    params: { authorization: Authorization; traceId: string } & OccurredAtHint,
    run: (idBound: IdBoundOptions) => Promise<T>,
  ): Promise<T> {
    return run(this.spanBound(params, "unbounded"));
  }

  async findTraceEventsByTraceId({
    authorization,
    traceId,
    occurredAtMs,
    reads,
  }: {
    authorization: Authorization;
    traceId: string;
  } & OccurredAtHint &
    TraceViewRead): Promise<DerivedTraceEvent[]> {
    const braided = readsOwnersSpans({ authorization, reads });
    try {
      return await this.readTraceEvents<DerivedTraceEvent[]>(
        { authorization, traceId, occurredAtMs },
        async (idBound) => {
          // Events only, unrolled after the election, so no heavy attribute is read.
          const result = await this.deps.reader.read({
            statement: spanEventsStatement({
              authorization,
              braided,
              traceId,
              newestFirst: false,
              limit: MAX_LIGHT_SPAN_READ_ROWS,
            }),
            table: storedSpans.$table.name,
            idBound,
          });

          const rows = eventRowsSchema.parse(result.rows);
          return rows.map((r) => ({
            spanId: r.event_id,
            timestamp: typeof r.started_at === "string" ? parseInt(r.started_at, 10) : r.started_at,
            name: r.event_type,
            attributes: r.attributes ?? {},
            ...(braided ? braidedOwnerOf({ authorization, tenantId: r.project_id }) : {}),
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
      // Pad time range by partition window to cover all spans within list traces.
      const fromMs = timeRange.from - DEFAULT_PARTITION_WINDOW_MS;
      const toMs = timeRange.to + DEFAULT_PARTITION_WINDOW_MS;
      const result = await this.deps.reader.read({
        statement: traceEventRollupStatement({ authorization, traceIds, fromMs, toMs }),
        table: storedSpans.$table.name,
      });

      return toTraceEventRollups(traceEventRollupRowsSchema.parse(result.rows));
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
        async (idBound) => {
          // The trace events' shape, with exception events dropped per event.
          const result = await this.deps.reader.read({
            statement: spanEventsStatement({
              authorization,
              braided: false,
              traceId,
              newestFirst: true,
              withoutExceptions: true,
            }),
            table: storedSpans.$table.name,
            idBound,
          });

          return eventRowsSchema.parse(result.rows).map(mapEventRow);
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
    ownerProjectId,
    occurredAtMs,
  }: SingleSpanParams): Promise<ElasticSearchEvent[]> {
    const ownerRead = singleSpanOwnerRead({ authorization, ownerProjectId });
    if (ownerRead.kind === "unreadable") return [];
    try {
      return await this.readTraceEvents<ElasticSearchEvent[]>(
        { authorization, traceId, occurredAtMs },
        async (idBound) => {
          const braided = ownerRead.kind === "braided";
          const result = await this.deps.reader.read({
            statement: spanEventsStatement({
              authorization,
              braided,
              traceId,
              spanId,
              newestFirst: true,
              settings: SINGLE_SPAN_FETCH_SETTINGS,
            }),
            table: storedSpans.$table.name,
            idBound,
          });
          const rows = eventRowsSchema.parse(result.rows);
          // Under braids each project holding the span id has a version; the owner's is kept.
          return (
            braided ? rows.filter((row) => row.project_id === ownerRead.ownerProjectId) : rows
          ).map(mapEventRow);
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
    reads,
  }: {
    authorization: Authorization;
    traceId: string;
  } & OccurredAtHint &
    TraceViewRead): Promise<SpanSummaryRow[]> {
    const braided = readsOwnersSpans({ authorization, reads });
    return this.readTraceSpans<SpanSummaryRow[]>(
      { authorization, traceId, occurredAtMs },
      async (idBound) => {
        const result = await this.deps.reader.read({
          statement: lightSpansStatement({
            authorization,
            braided,
            traceId,
            selection: SUMMARY_SPAN_SELECTION,
          }),
          table: storedSpans.$table.name,
          idBound,
        });

        const rows = spanSummaryQueryRowsSchema.parse(result.rows);
        return rows.map((row) => ({
          ...SpanStorageClickHouseRepository.mapSpanSummaryRow(row),
          ...(braided ? braidedOwnerOf({ authorization, tenantId: row.TenantId }) : {}),
        }));
      },
    );
  }

  async findLangwatchSignalsByTraceId({
    authorization,
    traceId,
    occurredAtMs,
    reads,
  }: {
    authorization: Authorization;
    traceId: string;
  } & OccurredAtHint &
    TraceViewRead): Promise<SpanLangwatchSignalsRow[]> {
    const braided = readsOwnersSpans({ authorization, reads });
    // Emptiness is judged on the rows ClickHouse returned, before the signal-less
    // spans are dropped: a trace with no signals is not a stale hint.
    const bySpan = await this.readTraceSpans<SpanLangwatchSignalsRow[]>(
      { authorization, traceId, occurredAtMs },
      async (idBound) => {
        const result = await this.deps.reader.read({
          statement: langwatchSignalsStatement({ authorization, braided, traceId }),
          table: storedSpans.$table.name,
          idBound,
        });

        const rows = signalsRowsSchema.parse(result.rows);

        const validBuckets = new Set<string>(LANGWATCH_SIGNAL_BUCKETS);
        return rows.map((r) => ({
          spanId: r.SpanId,
          signals: Array.isArray(r.Signals)
            ? r.Signals.filter((s): s is LangwatchSignalBucket => validBuckets.has(s))
            : [],
          ...(braided ? braidedOwnerOf({ authorization, tenantId: r.TenantId }) : {}),
        }));
      },
    );
    return bySpan.filter((r) => r.signals.length > 0);
  }

  async listSpansPaginated({
    authorization,
    traceId,
    limit,
    offset,
    occurredAtMs,
    reads,
  }: {
    authorization: Authorization;
    traceId: string;
    limit: number;
    offset: number;
  } & OccurredAtHint &
    TraceViewRead): Promise<PagedOwnedSpans> {
    const braided = readsOwnersSpans({ authorization, reads });
    return this.readTraceSpans<PagedOwnedSpans>(
      { authorization, traceId, occurredAtMs },
      async (idBound) => {
        // One bounded read counts the spans and finds their range, so the page reads that range.
        const rangeResult = await this.deps.reader.read({
          statement: spanRangeStatement({ authorization, braided, traceId }),
          table: storedSpans.$table.name,
          idBound,
        });
        const [range] = spanRangeRowsSchema.parse(rangeResult.rows);
        if (range === undefined) return { spans: [], total: 0, totalOwnerProjectIds: [] };

        // Bounded by the exact span range the index-bounded read above found.
        const pageResult = await this.deps.reader.read({
          statement: spanPageStatement({
            authorization,
            braided,
            traceId,
            fromMs: Number(range.FromMs),
            toMs: Number(range.ToMs),
            limit,
            offset,
          }),
          table: storedSpans.$table.name,
        });
        const pageRows = fullSpanRowsSchema.parse(pageResult.rows);
        // A braided total names the projects it counts, or its owners would go unaudited.
        if (braided && range.Tenants === undefined) {
          throw new Error("A braided span count came back without the projects it counts");
        }

        return {
          spans: ownedSpansOf({ rows: pageRows, authorization, braided }),
          total: Number(range.Total),
          totalOwnerProjectIds: (range.Tenants ?? []).flatMap(
            (tenantId) => braidedOwnerOf({ authorization, tenantId }).ownerProjectId ?? [],
          ),
        };
      },
    );
  }

  async findSpansSince({
    authorization,
    traceId,
    sinceStartTimeMs,
    reads,
  }: {
    authorization: Authorization;
    traceId: string;
    sinceStartTimeMs: number;
  } & OccurredAtHint &
    TraceViewRead): Promise<OwnedSpan[]> {
    const braided = readsOwnersSpans({ authorization, reads });
    // Poll reader: `StartTime > sinceStartTimeMs` is already a partition-pruning
    // lower bound, so this does NOT resolve or clamp to the trace's OccurredAt
    // window. A `StartTime <= OccurredAt + 2d` upper bound would silently hide
    // new spans on a trace still active more than 2 days after its
    // trace_summaries.OccurredAt (the live delta view would just stop updating).
    const result = await this.deps.reader.read({
      statement: spansSinceStatement({ authorization, braided, traceId, sinceStartTimeMs }),
      table: storedSpans.$table.name,
    });

    const rows = fullSpanRowsSchema.parse(result.rows);
    return ownedSpansOf({ rows, authorization, braided });
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
    // A cross-trace scan bounded by the StartTime window, reading two Map subscripts only.
    const result = await this.deps.reader.read({
      statement: modelUsageStatement({ authorization, fromMs, limit }),
      table: storedSpans.$table.name,
    });

    const rows = modelUsageRowsSchema.parse(result.rows);
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

    // Narrow to candidate traces via Models, then scan their spans.
    const result = await this.deps.reader.read({
      statement: recentModelSpansStatement({ authorization, models, fromMs, perModelLimit, limit }),
      table: storedSpans.$table.name,
    });

    const rows = modelSpanSampleQueryRowsSchema.parse(result.rows);
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
      CreatedAt: toDate(nowInstant()),
      UpdatedAt: toDate(nowInstant()),
      _retention_days: span.retentionDays ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    } satisfies ClickHouseSpanWriteRecord;
  }

  static mapSpanSummaryRow(row: SpanSummaryQueryRow): SpanSummaryRow {
    const explicitCost = parseAttrNumber(row.UsageCost);
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
