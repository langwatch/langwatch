import type { Trace } from "@langwatch/trace-contract";

const HEX_ONLY = /^[0-9a-f]+$/i;
const SCENARIO_RUN_ID_PREFIX = "scenariorun_";
const OTEL_SPAN_ID = /^[0-9a-f]{16}$/;
const SDK_SPAN_ID_PREFIX = "span_";
/** Shorter hex ids are not resolved as prefixes: a typo would scan every summary. */
const MIN_TRACE_ID_PREFIX_LENGTH = 8;
/** Hex ids this long or longer are literal trace ids, never prefixes. */
const FULL_TRACE_ID_LENGTH = 32;

/** How a by-id read found the trace when the id was not its exact trace id. */
export type TraceLookupResolvedFrom = "trace_id_prefix" | "span_id" | "scenario_run_id";

/** Every kind of read a by-id lookup may run for an id, in the order it runs them. */
export type TraceIdLookupKind = "trace_id" | "stored_spans" | TraceLookupResolvedFrom;

/** A trace a by-id read answered, with how it was found when that was not the exact id. */
export type TraceByIdRead = Trace & {
  lookup?: { requestedId: string; resolvedFrom: TraceLookupResolvedFrom };
  /** Built from stored spans: the summary (input, output, cost) is not written yet. */
  stillIngesting?: true;
};

/**
 * The id as stored: trimmed, and lower-cased when it is hex, since OTel writes hex ids lower
 * case and people paste them upper case. A non-hex SDK id keeps its case.
 */
export function normaliseTraceLookupId(raw: string): string {
  const trimmed = raw.trim();
  return HEX_ONLY.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

export function isHexId(id: string): boolean {
  return HEX_ONLY.test(id);
}

export function isScenarioRunId(id: string): boolean {
  return id.startsWith(SCENARIO_RUN_ID_PREFIX);
}

/** An OTel span id (16 hex) or an SDK one (`span_...`): the only ids worth a span scan. */
export function looksLikeSpanId(id: string): boolean {
  return OTEL_SPAN_ID.test(id) || id.startsWith(SDK_SPAN_ID_PREFIX);
}

/** A hex id between the minimum prefix length and a full trace id: worth a prefix read. */
export function isTraceIdPrefix(id: string): boolean {
  return id.length < FULL_TRACE_ID_LENGTH && id.length >= MIN_TRACE_ID_PREFIX_LENGTH && isHexId(id);
}

/**
 * The reads a by-id lookup runs for a normalised id that matches nothing: the exact id and the
 * stored spans always, then only the alternate kinds the id is shaped like.
 */
export function traceIdLookupKinds(id: string): TraceIdLookupKind[] {
  const kinds: TraceIdLookupKind[] = ["trace_id", "stored_spans"];
  if (isTraceIdPrefix(id)) kinds.push("trace_id_prefix");
  if (isScenarioRunId(id)) kinds.push("scenario_run_id");
  else if (looksLikeSpanId(id)) kinds.push("span_id");
  return kinds;
}
