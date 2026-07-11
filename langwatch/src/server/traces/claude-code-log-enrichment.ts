/**
 * Legacy read-path adapter for Claude Code log→span content enrichment.
 *
 * Claude Code's real OTLP `llm_request` spans carry tokens / `request_id` but NO
 * message content and NO cost — those live only in the trace's OTLP LOG records
 * (`assistant_response` / `user_prompt` on the LIGHT path; `api_*_body` on the
 * pre-flip fallback; `cost_usd` on the `api_request` anchor). The legacy
 * trace/span read path (`TraceService`) returns whole {@link Span}s, and exports
 * + evals read `Span.input` / `Span.output` / `Span.metrics.cost`, so those must
 * be joined server-side.
 *
 * This module adapts the legacy {@link Span} shape and the stored log rows into
 * the pure {@link computeClaudeSpanEnrichment} join, then attaches the (already
 * capped) `input` / `output` and authoritative `cost` back onto the spans.
 *
 * Pure — no IO. The caller (`TraceService.getById`) origin-gates and fetches the
 * logs. Idempotent and a no-op (returns the same spans) when the trace has no
 * Claude content logs, so a non-Claude trace that slips through pays nothing.
 */
import {
  computeClaudeSpanEnrichment,
  type ClaudeContentLog,
  type ClaudeSpanRef,
} from "~/server/app-layer/traces/claude-code-span-enrichment";
import type { StoredLogRecordRow } from "~/server/app-layer/traces/repositories/log-record-storage.repository";
import type { Span } from "~/server/tracer/types";

/**
 * The trace-origin value Claude Code (and other coding assistants) carry. Only
 * traces of this origin pay for the log read + enrichment; every other trace
 * short-circuits before any work.
 */
export const CODING_AGENT_ORIGIN = "coding_agent";

/** OTLP log attribute keys the content events carry (all string-valued in CH). */
const EVENT_NAME_ATTR = "event.name";
const REQUEST_ID_ATTR = "request_id";
const QUERY_SOURCE_ATTR = "query_source";
const BODY_ATTR = "body";
const COST_USD_ATTR = "cost_usd";

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
    .filter((span) => readStringParam(span.params, SPAN_REQUEST_ID_KEY) !== null)
    .slice()
    .sort((a, b) => a.timestamps.started_at - b.timestamps.started_at)
    .map((span) => ({
      spanId: span.span_id,
      requestId: readStringParam(span.params, SPAN_REQUEST_ID_KEY),
      querySource: readStringParam(span.params, SPAN_QUERY_SOURCE_KEY),
    }));
}

/**
 * Map stored log rows to {@link ClaudeContentLog}. The event payload rides the
 * `body` attribute (not the OTLP Body column); `cost_usd` is parsed off the
 * `api_request` anchor.
 */
export function mapLogRowsToClaudeContentLogs(
  rows: StoredLogRecordRow[],
): ClaudeContentLog[] {
  return rows.map((row) => {
    const attrs = row.attributes;
    const costRaw = attrs[COST_USD_ATTR];
    const cost = costRaw !== undefined ? Number(costRaw) : null;
    return {
      eventName: attrs[EVENT_NAME_ATTR] ?? "",
      requestId: nonEmptyOrNull(attrs[REQUEST_ID_ATTR]),
      querySource: nonEmptyOrNull(attrs[QUERY_SOURCE_ATTR]),
      timeUnixMs: row.timeUnixMs,
      body: nonEmptyOrNull(attrs[BODY_ATTR]),
      costUsd: cost !== null && Number.isFinite(cost) ? cost : null,
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
