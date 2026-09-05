/**
 * Reading an offloaded value back out of an `event_log` row: the partition window the event id
 * implies, the shapes the payload may take, and which of them carries the field asked for. Pure,
 * so the query and its parsing are stated once and the read path only issues the SELECT.
 */

import { Ksuid } from "@langwatch/ksuid";
import { z } from "zod";

/**
 * Half-width of the EventOccurredAt window for event_log blob reads. KSUID creation time and
 * EventOccurredAt come from the same ingestion clock, within queue lag of each other, so two days
 * either side covers the skew while pruning to the partitions the row can live in.
 */
const EVENT_LOG_OCCURRED_AT_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Extracts the creation time (ms) embedded in a KSUID EventId, or null when the
 * id is not a parseable KSUID (so callers fall back to an unpruned read rather
 * than risk excluding the row).
 */
function parseKsuidCreatedAtMs(eventId: string): number | null {
  try {
    return Ksuid.parse(eventId).date.getTime();
  } catch {
    return null;
  }
}

/** ClickHouse query response row from the event_log SELECT. */
export const eventLogRowSchema = z.object({ EventPayload: z.string() });

/**
 * Span attribute entry inside EventPayload, which stores raw OTLP spans. The read path needs only
 * offloaded IO fields, so this reads stringValue alone. Attributes are parsed per element, so a
 * malformed sibling can never fail the whole-array parse and mask the offloaded field.
 */
const spanAttributeSchema = z.object({
  key: z.string(),
  value: z.object({ stringValue: z.string().optional() }),
});

/**
 * @see ADR-022
 * Parsed EventPayload structure, the full event as stored by the command worker; the span write
 * shape sits at the top level with no outer data wrapper. Attributes stay unknown per element.
 */
export const eventPayloadSchema = z.object({
  span: z
    .object({
      attributes: z.array(z.unknown()),
    })
    .optional(),
  body: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Transient spool object path (single source of truth)
// ---------------------------------------------------------------------------

/** One parsed payload as a typed shape, so the reader below can be stated without a cast. */
export type EventLogPayload = z.infer<typeof eventPayloadSchema>;

/**
 * The window a read prunes to, derived from the event id rather than a caller-supplied time, so it
 * is correct with nothing to thread. Rows with an unknown occurred time are always kept, so the
 * window can never hide a present row.
 */
export function eventLogOccurredAtWindow(eventId: string): {
  predicate: string;
  params: Record<string, number>;
} {
  const occurredAtMs = parseKsuidCreatedAtMs(eventId);
  if (occurredAtMs === null) {
    return { predicate: "", params: {} };
  }

  return {
    predicate: `AND (
            EventOccurredAt = 0
            OR (
              EventOccurredAt >= {occurredAtFromMs:UInt64}
              AND EventOccurredAt <= {occurredAtToMs:UInt64}
            )
          )`,
    params: {
      occurredAtFromMs: Math.max(0, Math.floor(occurredAtMs - EVENT_LOG_OCCURRED_AT_WINDOW_MS)),
      occurredAtToMs: Math.floor(occurredAtMs + EVENT_LOG_OCCURRED_AT_WINDOW_MS),
    },
  };
}

/**
 * The offloaded value the payload holds for `field`, or null when it holds none. A log-record body
 * sits at the top level; a span attribute is found by key, each entry parsed on its own so a
 * malformed sibling can never mask the offloaded field.
 */
export function readEventPayloadField(payload: EventLogPayload, field: string): string | null {
  if (field === "body") {
    return typeof payload.body === "string" ? payload.body : null;
  }

  for (const raw of payload.span?.attributes ?? []) {
    const attr = spanAttributeSchema.safeParse(raw);
    if (
      attr.success &&
      attr.data.key === field &&
      typeof attr.data.value.stringValue === "string"
    ) {
      return attr.data.value.stringValue;
    }
  }

  return null;
}
