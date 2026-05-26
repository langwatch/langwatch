import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../schemas/spans";

type TraceEvent = NonNullable<TraceSummaryData["events"]>[number];

/**
 * Total byte budget for the hoisted events list on a trace summary.
 *
 * The events list is append-only across every span of a trace, and each
 * event carries arbitrary attribute payloads. Without a cap, a single
 * large trace (e.g. a long agent conversation emitting tracked events on
 * hundreds of spans) grows the fold state into the multi-megabyte range.
 * A state that big no longer fits the write-through cache, so every fold
 * step re-reads the full state from the persistent store — quadratic work
 * that lets one trace saturate the shared single-threaded queue.
 *
 * 256 KiB keeps the events contribution to the state small enough to stay
 * cacheable while still surfacing a generous number of tracked events at
 * the trace level. The full events always remain on the individual spans.
 */
export const TRACE_EVENTS_MAX_BYTES = 256 * 1024;

function eventByteSize(event: TraceEvent): number {
  return Buffer.byteLength(JSON.stringify(event), "utf8");
}

/**
 * Hoists span events into the trace summary, bounded by a total byte budget.
 *
 * Every OTel span can carry zero or more events (e.g. exceptions, user
 * feedback, checkpoints). They are appended to the accumulated events
 * array so they're available at the trace level without re-reading
 * individual spans — but only up to {@link TRACE_EVENTS_MAX_BYTES}. Once
 * the budget is reached the earliest events are kept and later ones are
 * dropped, with `dropped` set so the projection can flag the truncation.
 */
export function accumulateEvents({
  state,
  span,
}: {
  state: TraceSummaryData;
  span: NormalizedSpan;
}): { events: TraceSummaryData["events"]; dropped: boolean } {
  const existing = state.events ?? [];

  if (span.events.length === 0) {
    return { events: state.events, dropped: false };
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

  let usedBytes = existing.reduce((sum, e) => sum + eventByteSize(e), 0);
  const accumulated = [...existing];
  let dropped = false;

  for (const event of newEvents) {
    const size = eventByteSize(event);
    if (usedBytes + size > TRACE_EVENTS_MAX_BYTES) {
      dropped = true;
      break;
    }
    accumulated.push(event);
    usedBytes += size;
  }

  return { events: accumulated, dropped };
}
