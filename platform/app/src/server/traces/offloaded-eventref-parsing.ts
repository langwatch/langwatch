/**
 * Shared parsing of `langwatch.reserved.eventref.*` pointers off a span's flat
 * spanAttributes (ADR-022 read path). Used by BOTH the per-trace resolver
 * ({@link ./resolve-offloaded-traces}) and the bulk batch resolver
 * ({@link ./resolve-offloaded-traces-batch}) so the eventref shape is decoded
 * in exactly one place.
 */
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
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

/** True when the attribute map carries at least one eventref pointer. */
export function hasEventRefs(attributes: NormalizedAttributes): boolean {
  return Object.keys(attributes).some((key) => key.startsWith(EVENTREF_ATTR_PREFIX));
}

/**
 * Splits a span's flat attributes into the preview attributes (reserved keys
 * stripped) and the well-formed eventref pointers to resolve.
 *
 * - A reserved key missing/empty `eventId` is recorded in `missingEventIdKeys`
 *   (the caller logs a warning and keeps the preview) — never resolved.
 * - A reserved key with malformed JSON is silently dropped (the preview already
 *   sits in `cleanedAttrs` under the non-reserved IO key).
 */
export function parseSpanEventRefs(attrs: NormalizedAttributes): ParsedSpanEventRefs {
  const cleanedAttrs: NormalizedAttributes = {};
  const eventrefEntries: EventRefEntry[] = [];
  const missingEventIdKeys: string[] = [];

  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith(EVENTREF_ATTR_PREFIX)) {
      const attrKey = key.slice(EVENTREF_ATTR_PREFIX.length);
      try {
        const decoded = typeof value === "string" ? JSON.parse(value) : value;
        if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
          continue;
        }
        const ref = decoded as { field?: unknown; eventId?: unknown };
        if (typeof ref.eventId !== "string" || ref.eventId.length === 0) {
          missingEventIdKeys.push(attrKey);
          continue;
        }
        eventrefEntries.push({
          attrKey,
          field:
            typeof ref.field === "string" && ref.field.length > 0 ? ref.field : attrKey,
          eventId: ref.eventId,
        });
      } catch {
        // Malformed eventref JSON — skip; preview in cleanedAttrs is still shown.
      }
    } else {
      cleanedAttrs[key] = value;
    }
  }

  return { cleanedAttrs, eventrefEntries, missingEventIdKeys };
}
