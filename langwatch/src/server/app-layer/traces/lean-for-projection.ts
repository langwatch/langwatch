/**
 * ADR-022: Single source of truth for the lean shape used by the projection queue.
 *
 * `leanForProjection` is invoked at TWO call sites:
 *   (a) eventSourcingService.ts:242-251 (live, between storeEvents and router.dispatch)
 *   (b) replayExecutor.apply (replay, before invoking projection.apply)
 *
 * Same utility at both sites → projection state is path-independent. Tests pin this
 * invariant in lean-for-projection.unit.test.ts + replay-projection-parity.integration.test.ts.
 */

import type { Event } from "~/server/event-sourcing";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_TYPE,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";

/**
 * Spans whose serialized command payload exceeds this threshold are spooled to S3 at
 * the edge, with the command carrying `{spoolRef}` only. Matches the existing
 * `capOversizedAttributes` boundary.
 */
export const COMMAND_INLINE_THRESHOLD = 256 * 1024;

/**
 * Preview budget for IO attributes. Covers a complete chat-style Claude completion at
 * the common max_tokens=8192 setting (~16K tokens × 4 chars/token ≈ 64 KB).
 * Configurable via `LANGWATCH_IO_PREVIEW_BYTES`.
 */
export const IO_PREVIEW_BYTES = 64 * 1024;

/**
 * Set of span attribute keys that are considered "IO" and receive the wide IO_PREVIEW_BYTES
 * budget. Non-IO attributes stay at the existing 2 KB cap.
 */
export const IO_ATTR_KEYS = new Set([
  "langwatch.input",
  "langwatch.output",
  "gen_ai.input.messages",
  "gen_ai.output.messages",
]);

/**
 * Server-internal namespace prefix used by `leanForProjection` to attach eventref pointers
 * (carrying `{ field }`) alongside lean attribute previews. Client-supplied attributes in
 * the `langwatch.reserved.*` namespace are stripped at command-worker ingestion.
 */
export const EVENTREF_ATTR_PREFIX = "langwatch.reserved.eventref.";

/** UTF-8-safe truncation to at most `maxBytes`, backing off to a codepoint boundary. */
function utf8Preview(value: string, maxBytes: number): string {
  const buf = Buffer.from(value, "utf-8");
  if (buf.byteLength <= maxBytes) return value;
  let end = maxBytes;
  // 0b10xxxxxx are UTF-8 continuation bytes — don't cut mid-codepoint.
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf-8") + "…";
}

/**
 * Rewrites over-threshold IO attribute values to a preview (≤ IO_PREVIEW_BYTES) and attaches
 * a `langwatch.reserved.eventref.<attrKey>` pointer carrying `{ field: <attrKey> }`.
 *
 * - SpanReceived: for each IO attr in IO_ATTR_KEYS that exceeds IO_PREVIEW_BYTES bytes,
 *   replaces the value with a UTF-8-safe preview and attaches an eventref.
 * - LogRecordReceived: if body exceeds IO_PREVIEW_BYTES bytes, replaces body with preview
 *   and attaches eventref.body.
 * - Other event types: pass through unchanged (no-op).
 *
 * The returned event is deeply independent of the input — no shared array references —
 * so mutations to the leaned event do not ripple back to the event stored in event_log.
 *
 * @param event - The event to lean.
 * @returns A new event with IO attributes replaced by previews + eventrefs, or the original
 *   event if no leaning was necessary.
 */
export function leanForProjection(event: Event): Event {
  if (event.type === SPAN_RECEIVED_EVENT_TYPE) {
    return leanSpanReceivedEvent(event);
  }
  if (event.type === LOG_RECORD_RECEIVED_EVENT_TYPE) {
    return leanLogRecordReceivedEvent(event);
  }
  return event;
}

/**
 * Leans a SpanReceived event by truncating over-threshold IO attributes and
 * attaching eventref pointers. Returns a shallow-cloned event with a new attributes
 * array (no shared refs).
 */
function leanSpanReceivedEvent(event: Event): Event {
  const data = event.data as {
    span?: {
      attributes?: Array<{ key: string; value: { stringValue?: string } }>;
    };
  };

  // Guard: if span or attributes are absent (e.g. test events with empty data), pass through unchanged.
  if (!data || !data.span) {
    return event;
  }

  const originalAttributes = data.span.attributes ?? [];
  const newAttrs: Array<{ key: string; value: { stringValue?: string } }> = [];
  const eventrefAttrs: Array<{ key: string; value: { stringValue: string } }> = [];

  for (const attr of originalAttributes) {
    if (
      IO_ATTR_KEYS.has(attr.key) &&
      typeof attr.value.stringValue === "string" &&
      Buffer.byteLength(attr.value.stringValue, "utf-8") > IO_PREVIEW_BYTES
    ) {
      // Replace with preview
      const preview = utf8Preview(attr.value.stringValue, IO_PREVIEW_BYTES);
      newAttrs.push({ key: attr.key, value: { stringValue: preview } });
      // Attach eventref pointer
      eventrefAttrs.push({
        key: `${EVENTREF_ATTR_PREFIX}${attr.key}`,
        value: { stringValue: JSON.stringify({ field: attr.key }) },
      });
    } else {
      newAttrs.push({ ...attr, value: { ...attr.value } });
    }
  }

  if (eventrefAttrs.length === 0) {
    // Nothing changed — return original to avoid unnecessary allocations
    return event;
  }

  return {
    ...event,
    data: {
      ...data,
      span: {
        ...data.span,
        attributes: [...newAttrs, ...eventrefAttrs],
      },
    },
  };
}

/**
 * Leans a LogRecordReceived event by truncating the body if it exceeds IO_PREVIEW_BYTES
 * and attaching an eventref pointer in the event's attributes.
 */
function leanLogRecordReceivedEvent(event: Event): Event {
  const data = event.data as {
    body: string;
    attributes?: Record<string, string>;
  };

  if (
    typeof data.body !== "string" ||
    Buffer.byteLength(data.body, "utf-8") <= IO_PREVIEW_BYTES
  ) {
    return event;
  }

  const preview = utf8Preview(data.body, IO_PREVIEW_BYTES);
  const eventrefKey = `${EVENTREF_ATTR_PREFIX}body`;

  return {
    ...event,
    data: {
      ...data,
      body: preview,
      attributes: {
        ...(data.attributes ?? {}),
        [eventrefKey]: JSON.stringify({ field: "body" }),
      },
    },
  };
}
