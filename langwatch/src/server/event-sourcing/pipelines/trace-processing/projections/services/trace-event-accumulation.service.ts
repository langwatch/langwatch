import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../schemas/spans";

type TraceEvent = NonNullable<TraceSummaryData["events"]>[number];

/**
 * Hoists all span events into the trace summary.
 *
 * Every OTel span can carry zero or more events (e.g. exceptions, user
 * feedback, checkpoints). This function appends them all to the
 * accumulated events array so they're available at the trace level
 * without needing to re-read individual spans.
 */
export function accumulateEvents({
  state,
  span,
}: {
  state: TraceSummaryData;
  span: NormalizedSpan;
}): TraceSummaryData["events"] {
  if (span.events.length === 0) {
    return state.events;
  }

  const newEvents: TraceEvent[] = span.events.map((e) => {
    const attrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(e.attributes)) {
      if (value != null) {
        attrs[key] = String(value);
      }
    }

    return {
      spanId: span.spanId,
      timestamp: e.timeUnixMs,
      name: e.name,
      attributes: attrs,
    };
  });

  return [...(state.events ?? []), ...newEvents];
}
