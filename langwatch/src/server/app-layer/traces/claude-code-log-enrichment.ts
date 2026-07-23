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
import type { Span } from "~/server/tracer/types";

import {
  type ClaudeContentLog,
  type ClaudeSpanRef,
  computeClaudeSpanEnrichment,
} from "./claude-code-span-enrichment";
import { DERIVED_ATTRS } from "./log-content-derivation";
import type { LogRecordStorageService } from "./log-record-storage.service";
import type { StoredLogRecordRow } from "./repositories/log-record-storage.repository";

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
 * span has a `request_id` for the logs to join onto. The gate every caller runs
 * BEFORE reading logs, so a trace with nothing to enrich never touches the log
 * store.
 */
export function hasClaudeModelCallSpans(spans: Span[]): boolean {
  return spans.some(
    (span) => readStringParam(span.params, SPAN_REQUEST_ID_KEY) !== null,
  );
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
 * Attach the joined `input` / `output` / `cost` onto the trace's spans. Returns
 * a new spans array (spans are shallow-cloned only where enriched); the original
 * array and untouched spans are returned as-is. No-op when there are no Claude
 * content logs.
 */
export function enrichSpansWithClaudeLogContent({
  spans,
  logRows,
}: {
  spans: Span[];
  logRows: StoredLogRecordRow[];
}): Span[] {
  if (spans.length === 0 || logRows.length === 0) return spans;

  const logs = mapLogRowsToClaudeContentLogs(logRows);
  const refs = mapSpansToClaudeRefs(spans);
  const enrichmentBySpanId = computeClaudeSpanEnrichment({ spans: refs, logs });
  if (enrichmentBySpanId.size === 0) return spans;

  return spans.map((span) => {
    const enrichment = enrichmentBySpanId.get(span.span_id);
    if (!enrichment) return span;

    const next: Span = { ...span };
    if (enrichment.input !== null) next.input = enrichment.input;
    if (enrichment.output !== null) next.output = enrichment.output;
    if (enrichment.cost !== null) {
      next.metrics = { ...(span.metrics ?? {}), cost: enrichment.cost };
    }
    return next;
  });
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
  if (!hasClaudeModelCallSpans(spans)) return spans;

  try {
    const logRows = await logRecords.getLogsByTraceId(
      tenantId,
      traceId,
      occurredAtMs,
    );
    if (logRows.length === 0) return spans;
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
    return spans;
  }
}
