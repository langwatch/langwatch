import type { Trace } from "@langwatch/trace-contract";

const HEX_ONLY = /^[0-9a-f]+$/i;
const SCENARIO_RUN_ID_PREFIX = "scenariorun_";

/** How a by-id read found the trace when the id was not its exact trace id. */
export type TraceLookupResolvedFrom = "trace_id_prefix" | "span_id" | "scenario_run_id";

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
