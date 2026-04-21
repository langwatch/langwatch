import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../schemas/spans";

type TraceEvent = NonNullable<TraceSummaryData["events"]>[number];

/**
 * Extracts LangWatch SDK events from span attributes and appends to accumulated events.
 *
 * Events are stored as flat span attributes with the `event.` prefix:
 *   - `event.type` → event name
 *   - `event.metrics.*` → numeric metrics
 *   - `event.details.*` → string details
 *
 * All `event.*` attributes are preserved in the event's attributes map
 * for downstream consumers (filter matching, Slack notifications, etc.).
 */
export function accumulateEvents({
  state,
  span,
}: {
  state: TraceSummaryData;
  span: NormalizedSpan;
}): TraceSummaryData["events"] {
  const eventType = span.spanAttributes["event.type"];
  if (typeof eventType !== "string" || !eventType) {
    return state.events;
  }

  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(span.spanAttributes)) {
    if (!key.startsWith("event.")) continue;
    if (value != null) {
      attrs[key] = String(value);
    }
  }

  const event: TraceEvent = {
    spanId: span.spanId,
    timestamp: span.startTimeUnixMs,
    name: eventType,
    attributes: attrs,
  };

  return [...(state.events ?? []), event];
}
