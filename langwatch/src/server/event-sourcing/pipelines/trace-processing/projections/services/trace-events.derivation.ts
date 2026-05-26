import type { NormalizedSpan } from "../../schemas/spans";

/**
 * Trace-level event derived from a span's OTel events. Shape matches the
 * trace-detail header `events` field and the trigger precondition event shape.
 */
export interface DerivedTraceEvent {
  spanId: string;
  timestamp: number;
  name: string;
  attributes: Record<string, string>;
}

/**
 * Derives the trace-level event list from the complete span set at read time.
 *
 * Every span can carry zero or more OTel events (exceptions, user feedback,
 * track_event payloads, custom evaluations). These used to be hoisted onto the
 * fold state via per-event `accumulateEvents`, which made the fold state grow
 * O(span-count) and turned folding into O(n^2). They are now derived from
 * stored_spans on read, keeping the fold O(1). The shaping (string-coerced
 * attribute values, one entry per span event, all events incl. exceptions)
 * matches what the fold produced.
 */
export function deriveTraceEventsFromSpans(
  spans: NormalizedSpan[],
): DerivedTraceEvent[] {
  const events: DerivedTraceEvent[] = [];

  for (const span of spans) {
    for (const e of span.events) {
      const attrs: Record<string, string> = {};
      for (const [key, value] of Object.entries(e.attributes)) {
        if (value != null) {
          attrs[key] = String(value);
        }
      }
      events.push({
        spanId: span.spanId,
        timestamp: e.timeUnixMs,
        name: e.name,
        attributes: attrs,
      });
    }
  }

  return events;
}
