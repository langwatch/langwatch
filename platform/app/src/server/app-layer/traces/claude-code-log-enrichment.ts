/**
 * Read-time Claude Code log→span content enrichment.
 *
 * Claude Code's real OTLP `llm_request` spans carry tokens / `request_id` but NO
 * message content and NO cost — those live only in the trace's OTLP LOG records
 * (`user_prompt` / `assistant_response` on the LIGHT path; `api_*_body` when
 * `OTEL_LOG_RAW_API_BODIES=1`; `cost_usd` on the `api_request` anchor). Every
 * read path that wants whole spans — the traces-v2 drawer, the legacy
 * trace/span API, exports, evals — must join the two server-side.
 *
 * This module adapts the stored log rows and the legacy {@link Span} shape into
 * the pure {@link computeClaudeSpanEnrichment} join, then attaches the (already
 * capped) `input` / `output` and authoritative `cost` back onto the spans.
 *
 * {@link enrichSpansWithClaudeLogContent} is pure (no IO); the caller supplies
 * the log rows. {@link enrichCodingAgentSpansFromLogs} is the IO wrapper both
 * read paths call: it gates, reads the logs, and never fails the read.
 */
import type { Logger } from "pino";
import { capPayloadString } from "~/server/event-sourcing/pipelines/trace-processing/utils/capOversizedLogRecord";
import type { Span } from "~/server/tracer/types";
import {
  type ClaudeContentLog,
  type ClaudeSpanRef,
  type ClaudeToolLog,
  type ClaudeToolSpanRef,
  computeClaudeInteractionOutput,
  computeClaudeSpanEnrichment,
  computeClaudeToolSpanEnrichment,
} from "./claude-code-span-enrichment";
import { DERIVED_ATTRS } from "./log-content-derivation";
import type { LogRecordStorageService } from "./log-record-storage.service";
import type { StoredLogRecordRow } from "./repositories/log-record-storage.repository";
import type { SpanSummaryRow } from "./repositories/span-storage.repository";

/**
 * The trace-origin value Claude Code (and other coding assistants) carry. Only
 * traces of this origin pay for the log read + enrichment; every other trace
 * short-circuits before any work.
 */
export const CODING_AGENT_ORIGIN = "coding_agent";

/**
 * OTLP log attribute keys the content events carry (all string-valued in CH).
 *
 * Each event carries its payload under a DIFFERENT key — there is no shared
 * `body` convention, and assuming one silently yields no content:
 *   - `api_request_body` / `api_response_body` → `body` (the raw Messages JSON)
 *   - `user_prompt`                            → `prompt`  (`OTEL_LOG_USER_PROMPTS=1`)
 *   - `assistant_response`                     → `response` (`OTEL_LOG_ASSISTANT_RESPONSES`,
 *     which falls back to `OTEL_LOG_USER_PROMPTS` when unset)
 * See https://code.claude.com/docs/en/monitoring-usage. Reading only `body` for
 * all four left the LIGHT path (no `api_*_body` events to pair with) with no
 * span input AND no span output at all.
 */
const EVENT_NAME_ATTR = "event.name";
const REQUEST_ID_ATTR = "request_id";
const QUERY_SOURCE_ATTR = "query_source";
const BODY_ATTR = "body";
const COST_USD_ATTR = "cost_usd";
const PROMPT_ATTR = "prompt";
const RESPONSE_ATTR = "response";
const USER_PROMPT_EVENT = "user_prompt";
const ASSISTANT_RESPONSE_EVENT = "assistant_response";
const TOOL_DECISION_EVENT = "tool_decision";
const TOOL_RESULT_EVENT = "tool_result";
const TOOL_USE_ID_ATTR = "tool_use_id";
const TOOL_NAME_ATTR = "tool_name";
const TOOL_PARAMETERS_ATTR = "tool_parameters";
const TOOL_INPUT_ATTR = "tool_input";
const DECISION_ATTR = "decision";
const DECISION_SOURCE_ATTR = "source";
const RESULT_DECISION_SOURCE_ATTR = "decision_source";
const SUCCESS_ATTR = "success";
const DURATION_MS_ATTR = "duration_ms";
const RESULT_SIZE_ATTR = "tool_result_size_bytes";

/**
 * The attribute keys that can carry the event's content payload, in the order
 * {@link readContentBody} probes them (`body` is always the trailing
 * fallback). Exported for the API's log redaction: it must withhold EXACTLY
 * the keys a reader would surface, from this one mapping — a key listed here
 * but missed there leaks captured content through the raw-log and transcript
 * reads to viewers the data-privacy policy hides it from.
 */
export function contentAttrKeys(eventName: string): readonly string[] {
  if (eventName === USER_PROMPT_EVENT) return [PROMPT_ATTR, BODY_ATTR];
  if (eventName === ASSISTANT_RESPONSE_EVENT) return [RESPONSE_ATTR, BODY_ATTR];
  // Tool events: the span surface now shows tool_input / tool_parameters as
  // the tool span's INPUT, so the raw-log read must withhold the same keys —
  // anything surfaced-as-content but not listed here is a policy bypass.
  if (eventName === TOOL_RESULT_EVENT) {
    return [TOOL_INPUT_ATTR, TOOL_PARAMETERS_ATTR, BODY_ATTR];
  }
  if (eventName === TOOL_DECISION_EVENT) {
    return [TOOL_PARAMETERS_ATTR, BODY_ATTR];
  }
  return [BODY_ATTR];
}

/** The attribute carrying the event's content payload, per event name. */
function readContentBody(
  eventName: string,
  attrs: Record<string, string>,
): string | null {
  for (const key of contentAttrKeys(eventName)) {
    const value = nonEmptyOrNull(attrs[key]);
    if (value !== null) return value;
  }
  return null;
}

/** Span attribute keys (unflattened onto `Span.params` by the span mapper). */
const SPAN_REQUEST_ID_KEY = "request_id";
const SPAN_QUERY_SOURCE_KEY = "query_source";
const SPAN_TOOL_USE_ID_KEY = "tool_use_id";
const SPAN_TOOL_CALL_ID_KEY = "gen_ai.tool.call.id";
const SPAN_USER_PROMPT_KEY = "user_prompt";
/** The turn-root span every claude session emits per user prompt. */
const INTERACTION_SPAN_NAME = "claude_code.interaction";
const CLAUDE_SPAN_NAME_PREFIX = "claude_code.";

function readStringParam(
  params: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = params?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nonEmptyOrNull(value: string | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Map the trace's model-call spans to {@link ClaudeSpanRef}. Only spans that
 * carry a `request_id` (the real `llm_request` spans) participate: they are the
 * ones the logs join to, and restricting the set keeps the positional input
 * pairing (Nth span ↔ Nth request body / user prompt) aligned to model calls.
 * Sorted by start time so the positional order the pure fn relies on is the
 * call order.
 */
export function mapSpansToClaudeRefs(spans: Span[]): ClaudeSpanRef[] {
  return spans
    .filter(
      (span) => readStringParam(span.params, SPAN_REQUEST_ID_KEY) !== null,
    )
    .slice()
    .sort((a, b) => a.timestamps.started_at - b.timestamps.started_at)
    .map((span) => ({
      spanId: span.span_id,
      requestId: readStringParam(span.params, SPAN_REQUEST_ID_KEY),
      querySource: readStringParam(span.params, SPAN_QUERY_SOURCE_KEY),
    }));
}

/**
 * True when the trace carries Claude Code model-call spans — i.e. at least one
 * span has a `request_id` for the logs to join onto.
 */
export function hasClaudeModelCallSpans(spans: Span[]): boolean {
  return spans.some(
    (span) => readStringParam(span.params, SPAN_REQUEST_ID_KEY) !== null,
  );
}

function spanToolUseId(span: Span): string | null {
  return (
    readStringParam(span.params, SPAN_TOOL_USE_ID_KEY) ??
    readStringParam(span.params, SPAN_TOOL_CALL_ID_KEY)
  );
}

function isInteractionSpan(span: Span): boolean {
  return (
    span.name === INTERACTION_SPAN_NAME ||
    readStringParam(span.params, SPAN_USER_PROMPT_KEY) !== null
  );
}

/**
 * True when the trace has ANY span the claude log join could add content to:
 * a model call (`request_id`), a tool call (`tool_use_id`), or the turn's
 * interaction root. The gate every caller runs BEFORE reading logs, so a
 * trace with nothing to enrich never touches the log store.
 */
export function hasCodingAgentJoinableSpans(spans: Span[]): boolean {
  return spans.some(
    (span) =>
      readStringParam(span.params, SPAN_REQUEST_ID_KEY) !== null ||
      spanToolUseId(span) !== null ||
      isInteractionSpan(span),
  );
}

/**
 * True when THIS span could gain content from the claude join — the
 * single-span (spanDetail) twin of {@link hasCodingAgentJoinableSpans}. The
 * name prefix is included so future claude_code.* span shapes at least
 * attempt the join instead of silently skipping.
 */
export function isCodingAgentShapedSpan(span: Span): boolean {
  return (
    readStringParam(span.params, SPAN_REQUEST_ID_KEY) !== null ||
    spanToolUseId(span) !== null ||
    isInteractionSpan(span) ||
    (span.name ?? "").startsWith(CLAUDE_SPAN_NAME_PREFIX)
  );
}

/** Tool spans (`tool_use_id`-carrying) → exact-join refs. */
export function mapSpansToClaudeToolRefs(spans: Span[]): ClaudeToolSpanRef[] {
  const refs: ClaudeToolSpanRef[] = [];
  for (const span of spans) {
    const toolUseId = spanToolUseId(span);
    if (toolUseId !== null) refs.push({ spanId: span.span_id, toolUseId });
  }
  return refs;
}

/**
 * Interaction-span INPUT from its own `user_prompt` attribute — the one
 * claude content that rides the span itself, so it needs no log read and
 * must apply even when the trace has zero logs.
 */
export function enrichClaudeInteractionInputs(spans: Span[]): Span[] {
  let hasChanged = false;
  const next = spans.map((span) => {
    if (span.input != null) return span;
    const prompt = readStringParam(span.params, SPAN_USER_PROMPT_KEY);
    if (prompt === null) return span;
    hasChanged = true;
    return {
      ...span,
      input: {
        type: "text" as const,
        value: capPayloadString(prompt, undefined, "user_prompt"),
      },
    };
  });
  // Identity-preserving on no-op so callers' referential contracts (and
  // memoized readers) see an untouched trace as the SAME array.
  return hasChanged ? next : spans;
}

/**
 * Map stored log rows to {@link ClaudeContentLog}. The event payload rides the
 * `body` attribute (not the OTLP Body column) for the `api_*_body` events;
 * `user_prompt` carries its text on `prompt` instead. `cost_usd` is parsed off
 * the `api_request` anchor.
 */
export function mapLogRowsToClaudeContentLogs(
  rows: StoredLogRecordRow[],
): ClaudeContentLog[] {
  return rows.map((row) => {
    const attrs = row.attributes;
    const eventName = attrs[EVENT_NAME_ATTR] ?? "";
    const costRaw = attrs[COST_USD_ATTR];
    const cost = costRaw !== undefined ? Number(costRaw) : null;
    const toolCallCount = Number(attrs[DERIVED_ATTRS.OUTPUT_TOOL_CALL_COUNT]);
    return {
      eventName,
      requestId: nonEmptyOrNull(attrs[REQUEST_ID_ATTR]),
      querySource: nonEmptyOrNull(attrs[QUERY_SOURCE_ATTR]),
      timeUnixMs: row.timeUnixMs,
      body: readContentBody(eventName, attrs),
      costUsd: cost !== null && Number.isFinite(cost) ? cost : null,
      // Parsed out of the raw body once, at ingest, so the read path can skip
      // re-parsing it. Absent on records ingested before that existed, which is
      // why every consumer keeps its parse as a fallback.
      derivedOutputText: nonEmptyOrNull(attrs[DERIVED_ATTRS.OUTPUT_TEXT]),
      derivedToolCallCount: Number.isFinite(toolCallCount)
        ? toolCallCount
        : null,
    };
  });
}

/**
 * Attach the joined `input` / `output` / `cost` onto the trace's spans —
 * model calls (request_id join), tool calls (tool_use_id join), and the
 * interaction root (own attr + windowed reply). Returns a new spans array
 * (spans are shallow-cloned only where enriched); untouched spans are
 * returned as-is. The attribute-only interaction input applies even with
 * zero logs.
 */
export function enrichSpansWithClaudeLogContent({
  spans,
  logRows,
}: {
  spans: Span[];
  logRows: StoredLogRecordRow[];
}): Span[] {
  if (spans.length === 0) return spans;

  const withInteractionInputs = enrichClaudeInteractionInputs(spans);
  if (logRows.length === 0) return withInteractionInputs;

  const logs = mapLogRowsToClaudeContentLogs(logRows);
  const refs = mapSpansToClaudeRefs(withInteractionInputs);
  const enrichmentBySpanId = computeClaudeSpanEnrichment({ spans: refs, logs });
  const toolEnrichmentBySpanId = computeClaudeToolSpanEnrichment({
    spans: mapSpansToClaudeToolRefs(withInteractionInputs),
    toolLogs: mapLogRowsToClaudeToolLogs(logRows),
    contentLogs: logs,
  });

  return withInteractionInputs.map((span) => {
    const enrichment = enrichmentBySpanId.get(span.span_id);
    const toolEnrichment = toolEnrichmentBySpanId.get(span.span_id);
    const interactionOutput =
      span.output == null && isInteractionSpan(span)
        ? computeClaudeInteractionOutput({
            logs,
            windowStartMs: span.timestamps.started_at,
            windowEndMs: span.timestamps.finished_at,
          })
        : null;
    if (!enrichment && !toolEnrichment && interactionOutput === null) {
      return span;
    }

    const next: Span = { ...span };
    const input = enrichment?.input ?? toolEnrichment?.input ?? null;
    const output =
      enrichment?.output ?? toolEnrichment?.output ?? interactionOutput;
    if (input !== null && next.input == null) next.input = input;
    if (output !== null && next.output == null) next.output = output;
    if (enrichment?.cost != null) {
      next.metrics = { ...(span.metrics ?? {}), cost: enrichment.cost };
    }
    return next;
  });
}

/**
 * Map stored log rows to {@link ClaudeToolLog} (tool_decision / tool_result
 * events only). Success arrives as the string "true"/"false"; numbers as
 * stringified numerics — both parsed here so the pure join sees clean types.
 */
export function mapLogRowsToClaudeToolLogs(
  rows: StoredLogRecordRow[],
): ClaudeToolLog[] {
  const out: ClaudeToolLog[] = [];
  for (const row of rows) {
    const attrs = row.attributes;
    const eventName = attrs[EVENT_NAME_ATTR] ?? "";
    if (eventName !== TOOL_DECISION_EVENT && eventName !== TOOL_RESULT_EVENT) {
      continue;
    }
    out.push({
      eventName,
      toolUseId: nonEmptyOrNull(attrs[TOOL_USE_ID_ATTR]),
      toolName: nonEmptyOrNull(attrs[TOOL_NAME_ATTR]),
      toolParameters: nonEmptyOrNull(attrs[TOOL_PARAMETERS_ATTR]),
      toolInput: nonEmptyOrNull(attrs[TOOL_INPUT_ATTR]),
      decision: nonEmptyOrNull(attrs[DECISION_ATTR]),
      decisionSource:
        nonEmptyOrNull(attrs[RESULT_DECISION_SOURCE_ATTR]) ??
        nonEmptyOrNull(attrs[DECISION_SOURCE_ATTR]),
      success: parseBoolAttr(attrs[SUCCESS_ATTR]),
      durationMs: parseNumberAttr(attrs[DURATION_MS_ATTR]),
      resultSizeBytes: parseNumberAttr(attrs[RESULT_SIZE_ATTR]),
      timeUnixMs: row.timeUnixMs,
    });
  }
  return out;
}

function parseBoolAttr(value: string | undefined): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function parseNumberAttr(value: string | undefined): number | null {
  if (value === undefined || value.length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The IO wrapper both read paths share: gate on the trace actually having
 * Claude model-call spans, do one lazy, partition-pruned log read, and join the
 * content + cost onto the spans.
 *
 * Best-effort by design — a log-read failure returns the un-enriched spans
 * rather than failing the whole trace read, since the spans themselves (tokens,
 * timings, tool calls) are still worth showing without their content.
 */
export async function enrichCodingAgentSpansFromLogs({
  logRecords,
  tenantId,
  traceId,
  spans,
  occurredAtMs,
  logger,
}: {
  logRecords: LogRecordStorageService;
  tenantId: string;
  traceId: string;
  spans: Span[];
  /** Partition-pruning hint on the log store's `TimeUnixMs` partition key. */
  occurredAtMs?: number;
  logger?: Logger;
}): Promise<Span[]> {
  if (!hasCodingAgentJoinableSpans(spans)) return spans;

  try {
    const logRows = await logRecords.getLogsByTraceId(
      tenantId,
      traceId,
      occurredAtMs,
    );
    return enrichSpansWithClaudeLogContent({ spans, logRows });
  } catch (error) {
    logger?.warn(
      {
        tenantId,
        traceId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Claude Code log enrichment skipped: failed to read trace logs",
    );
    // Best-effort: the attribute-only interaction input needs no logs.
    return enrichClaudeInteractionInputs(spans);
  }
}

/**
 * Light summary rows → {@link ClaudeSpanRef}s for the single-span join: the
 * positional input pairing needs the WHOLE trace's model-call order, which the
 * summary read supplies without the full-span cost. Rows arrive start-time
 * sorted from the repository; sorted again here so the invariant doesn't hang
 * on the caller.
 */
export function mapSummaryRowsToClaudeRefs(
  rows: SpanSummaryRow[],
): ClaudeSpanRef[] {
  return rows
    .filter((row) => row.requestId !== null)
    .slice()
    .sort((a, b) => a.startTimeMs - b.startTimeMs)
    .map((row) => ({
      spanId: row.spanId,
      requestId: row.requestId,
      querySource: row.querySource,
    }));
}

/**
 * The single-span (spanDetail) join: enrich ONE fetched span using the
 * trace's logs plus (for model-call spans) the light summary refs that give
 * the positional input pairing its sibling order. PURE — the tracesV2 layer
 * owns the reads. Never overwrites a non-null field.
 */
export function enrichSingleSpanWithClaudeLogContent({
  span,
  modelCallRefs,
  logRows,
}: {
  span: Span;
  /** All model-call refs for the trace, [] when the span has no request_id. */
  modelCallRefs: ClaudeSpanRef[];
  logRows: StoredLogRecordRow[];
}): Span {
  const isModelCall =
    readStringParam(span.params, SPAN_REQUEST_ID_KEY) !== null;

  const [enriched] = enrichSpansWithClaudeLogContent({
    spans: [span],
    logRows,
  });
  let next = enriched!;

  // The bulk pass's tool join (exact, by tool_use_id) and interaction joins
  // (own attr + windowed reply) are single-span safe. Its model-call INPUT is
  // not: positional pairing needs the whole trace's call order, and a
  // one-span array degenerates to "this is the group's first call" — so for
  // model calls that input is discarded and the full-refs join below is the
  // only input source. Output and cost are exact request_id joins either way.
  if (isModelCall) {
    if (next !== span && next.input !== span.input) {
      next = { ...next, input: span.input };
    }
    if (modelCallRefs.length > 0 && logRows.length > 0) {
      const enrichment = computeClaudeSpanEnrichment({
        spans: modelCallRefs,
        logs: mapLogRowsToClaudeContentLogs(logRows),
      }).get(span.span_id);
      if (enrichment) {
        const clone: Span = { ...next };
        if (enrichment.input !== null && span.input == null) {
          clone.input = enrichment.input;
        }
        if (enrichment.output !== null && clone.output == null) {
          clone.output = enrichment.output;
        }
        if (enrichment.cost !== null) {
          clone.metrics = { ...(clone.metrics ?? {}), cost: enrichment.cost };
        }
        next = clone;
      }
    }
  }
  return next;
}
