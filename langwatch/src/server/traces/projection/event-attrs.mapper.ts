/**
 * Maps the `event.*` attributes of a stored_spans row into a trace Event.
 *
 * The events projection JOIN extracts only the `event.*` map entries from
 * stored_spans (mapFilter). This mapper turns one such row into the public
 * Event shape — mirroring extractEventsFromSpans (trace-summary.mapper) but
 * reading directly off the ClickHouse map rather than an unflattened span.
 */

import type { Event } from "~/server/tracer/types";

/** A stored_spans row carrying only the `event.*` attributes for one event span. */
export interface EventSpanRow {
  TraceId: string;
  SpanId: string;
  StartTimeMs: number;
  EndTimeMs: number;
  EventAttrs: Record<string, string>;
}

const METRICS_PREFIX = "event.metrics.";
const DETAILS_PREFIX = "event.details.";

export function mapEventAttrsToEvent({
  row,
  projectId,
}: {
  row: EventSpanRow;
  projectId: string;
}): Event | null {
  const attrs = row.EventAttrs ?? {};
  const eventType = attrs["event.type"];
  if (!eventType) return null;

  const metrics: Record<string, number> = {};
  const details: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith(METRICS_PREFIX)) {
      const num = Number(value);
      if (Number.isFinite(num)) {
        metrics[key.slice(METRICS_PREFIX.length)] = num;
      }
    } else if (key.startsWith(DETAILS_PREFIX)) {
      details[key.slice(DETAILS_PREFIX.length)] = value;
    }
  }

  return {
    event_id: row.SpanId,
    event_type: eventType,
    project_id: projectId,
    metrics,
    event_details: details,
    trace_id: row.TraceId,
    timestamps: {
      started_at: row.StartTimeMs,
      inserted_at: row.StartTimeMs,
      updated_at: row.EndTimeMs,
    },
  };
}
