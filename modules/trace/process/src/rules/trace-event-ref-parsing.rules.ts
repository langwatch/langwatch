/**
 * Shared parsing of `langwatch.reserved.eventref.*` pointers off a span's flat spanAttributes
 * (ADR-022 read path), used by the per-trace resolver and the bulk batch resolver alike so the
 * eventref shape is decoded in exactly one place.
 */
import { EVENTREF_ATTR_PREFIX } from "@langwatch/trace-contract";
import type { NormalizedAttributes } from "@langwatch/trace-contract";

/** One decoded eventref pointer ready to fetch from event_log. */
export interface EventRefEntry {
  /** The IO attribute key the resolved value belongs under (e.g. langwatch.output). */
  attrKey: string;
  /** The EventPayload field to extract (defaults to attrKey when absent). */
  field: string;
  /** The event_log EventId carrying the full value. */
  eventId: string;
}

/** Result of splitting a span's attributes into preview attrs + eventref pointers. */
export interface ParsedSpanEventRefs {
  /** Non-reserved attributes (previews and regular attrs), reserved keys removed. */
  cleanedAttrs: NormalizedAttributes;
  /** Well-formed eventref pointers to resolve. */
  eventrefEntries: EventRefEntry[];
  /** attrKeys whose eventref carried no usable eventId — caller warns + keeps preview. */
  missingEventIdKeys: string[];
}

type EventRefResult =
  | { kind: "valid"; entry: EventRefEntry }
  | { kind: "missing-event-id" }
  | { kind: "malformed" };

/** True when the attribute map carries at least one eventref pointer. */
export function hasEventRefs(attributes: NormalizedAttributes): boolean {
  return Object.keys(attributes).some((key) => key.startsWith(EVENTREF_ATTR_PREFIX));
}

function decodeEventRef(attrKey: string, value: unknown): EventRefResult {
  let decoded: unknown;
  try {
    decoded = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return { kind: "malformed" };
  }

  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    return { kind: "malformed" };
  }

  const ref = decoded as { field?: unknown; eventId?: unknown };
  if (typeof ref.eventId !== "string" || ref.eventId.length === 0) {
    return { kind: "missing-event-id" };
  }

  return {
    kind: "valid",
    entry: {
      attrKey,
      field: typeof ref.field === "string" && ref.field.length > 0 ? ref.field : attrKey,
      eventId: ref.eventId,
    },
  };
}

/** Splits attributes into preview values and reserved eventref pointers. */
export function parseSpanEventRefs(attrs: NormalizedAttributes): ParsedSpanEventRefs {
  const cleanedAttrs: NormalizedAttributes = {};
  const eventrefEntries: EventRefEntry[] = [];
  const missingEventIdKeys: string[] = [];

  for (const [key, value] of Object.entries(attrs)) {
    if (!key.startsWith(EVENTREF_ATTR_PREFIX)) {
      cleanedAttrs[key] = value;
      continue;
    }

    const attrKey = key.slice(EVENTREF_ATTR_PREFIX.length);
    const result = decodeEventRef(attrKey, value);
    if (result.kind === "missing-event-id") {
      missingEventIdKeys.push(attrKey);
      continue;
    }

    if (result.kind === "valid") {
      eventrefEntries.push(result.entry);
    }
  }

  return { cleanedAttrs, eventrefEntries, missingEventIdKeys };
}
