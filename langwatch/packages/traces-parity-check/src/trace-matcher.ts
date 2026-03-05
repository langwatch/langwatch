/**
 * Trace matching utilities for identifying traces by run prefix,
 * service name, or time window.
 */

import type { Trace, TraceSummary } from "./types.js";

export type MatchMethod = "service.name" | "time-window";

/**
 * Create a predicate that matches traces belonging to a specific parity run.
 * Checks both dotted and underscored key variants.
 */
export function createRunPrefixFilter(
  runPrefix: string,
): (trace: Trace) => boolean {
  return (t: Trace) => {
    const meta = t.metadata ?? {};
    return (
      meta["parity.run"] === runPrefix || meta["parity_run"] === runPrefix
    );
  };
}

/**
 * Find a snippet's trace using OTEL resource attributes for identification.
 *
 * Matching priority:
 * 1. service.name metadata field (set via OTEL_SERVICE_NAME)
 * 2. Fallback: time-window matching (trace started_at within [startTime, endTime])
 */
export function findSnippetTrace({
  traces,
  serviceName,
  startTime,
  endTime,
}: {
  traces: Trace[];
  serviceName: string;
  startTime: number;
  endTime: number;
}): { trace: Trace; matchMethod: MatchMethod } | null {
  // Primary: match by service.name resource attribute
  const byServiceName = traces.find((t) => {
    const meta = t.metadata ?? {};
    return meta["service.name"] === serviceName;
  });
  if (byServiceName)
    return { trace: byServiceName, matchMethod: "service.name" };

  // Fallback: match by time window
  const byTimeWindow = traces.find((t) => {
    const ts = t.timestamps.started_at;
    return ts >= startTime && ts <= endTime;
  });
  if (byTimeWindow)
    return { trace: byTimeWindow, matchMethod: "time-window" };

  return null;
}

/**
 * Build a compact summary of a trace for the report.
 */
export function buildTraceSummary(trace: Trace): TraceSummary {
  const spans = trace.spans ?? [];
  const llmSpan = spans.find((s) => s.type === "llm");
  return {
    traceId: trace.trace_id,
    hasInput: !!trace.input?.value,
    hasOutput: !!trace.output?.value,
    spanCount: spans.length,
    spanTypes: [...new Set(spans.map((s) => s.type))].sort(),
    model: llmSpan?.model ?? null,
    durationMs: trace.metrics?.total_time_ms ?? null,
    promptTokens: trace.metrics?.prompt_tokens ?? null,
    completionTokens: trace.metrics?.completion_tokens ?? null,
  };
}
