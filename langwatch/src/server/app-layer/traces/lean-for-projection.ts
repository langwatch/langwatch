// ADR-022: lean transform — see ../lean-for-projection.ts header below.
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
import {
  capOversizedAttributes,
  DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
  hasOversizedAttribute,
} from "~/server/event-sourcing/pipelines/trace-processing/utils/capOversizedAttributes";
import type { OtlpSpan, OtlpResource } from "~/server/event-sourcing/pipelines/trace-processing/schemas/otlp";

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
  const buf = Buffer.from(value, "utf8");
  if (buf.byteLength <= maxBytes) return value;
  let end = maxBytes;
  // 0b10xxxxxx are UTF-8 continuation bytes — don't cut mid-codepoint.
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf8") + "…";
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
 * Leans a SpanReceived event by:
 *   1. Truncating over-threshold IO attributes (> IO_PREVIEW_BYTES) and attaching eventref pointers.
 *   2. Capping any remaining non-IO / nested / binary attribute values exceeding
 *      DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES via `capOversizedAttributes`.
 *
 * ORDER: IO 64 KB preview FIRST, then 256 KB cap on the result.
 * IO attrs are already ≤ 64 KB after step 1, so the 256 KB cap never touches them — correct.
 * Non-IO attrs get the 256 KB ceiling, matching the pre-spool worker behaviour.
 * Non-IO caps get NO eventref (recovery is via full event_log read, not field-eventref).
 *
 * CLONE SAFETY: `capOversizedAttributes` mutates in place and recurses into nested objects.
 * We scan the original attributes first (no allocation) to decide if the heavy path is needed.
 * If needed, we structuredClone the span (and resource), then re-run the IO-lean pass on the
 * CLONED attributes — so the original input event is byte-for-byte untouched. The clone only
 * happens on the "heavy" branch so the sub-threshold hot path stays allocation-free.
 */
function leanSpanReceivedEvent(event: Event): Event {
  const data = event.data as {
    span?: OtlpSpan;
    resource?: OtlpResource | null;
  };

  // Guard: if span or attributes are absent (e.g. test events with empty data), pass through unchanged.
  if (!data || !data.span) {
    return event;
  }

  const originalAttributes = data.span.attributes ?? [];

  // Step 1 (scan only): check whether any IO attr exceeds IO_PREVIEW_BYTES.
  let hasLargeIoAttr = false;
  for (const attr of originalAttributes) {
    if (
      IO_ATTR_KEYS.has(attr.key) &&
      typeof attr.value.stringValue === "string" &&
      Buffer.byteLength(attr.value.stringValue, "utf8") > IO_PREVIEW_BYTES
    ) {
      hasLargeIoAttr = true;
      break;
    }
  }

  // Step 2 (scan only): check whether any surface that capOversizedAttributes walks
  // (span.attributes, span.events[].attributes, span.links[].attributes, resource.attributes)
  // might need the 256 KB cap. Uses hasOversizedAttribute — the read-only counterpart
  // colocated with capOversizedAttributes — so the gate covers EVERY surface the action covers.
  const needsNonIoCap = hasOversizedAttribute(data.span, data.resource ?? null, DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES);

  if (!hasLargeIoAttr && !needsNonIoCap) {
    // Sub-threshold event — return original, no allocations.
    return event;
  }

  // Step 3: Deep-clone the span (and resource) so that all subsequent mutations —
  // the IO-lean pass and capOversizedAttributes — operate on independent copies.
  // structuredClone creates a fully independent deep copy; no shared object references remain.
  const clonedSpan: OtlpSpan = structuredClone(data.span);
  const clonedResource: OtlpResource | null = data.resource ? structuredClone(data.resource) : null;

  // Step 4: IO-lean pass — run on the CLONED attributes so originals stay untouched.
  if (hasLargeIoAttr) {
    const ioLeanedAttrs: OtlpSpan["attributes"] = [];
    const eventrefAttrs: OtlpSpan["attributes"] = [];

    for (const attr of clonedSpan.attributes) {
      if (
        IO_ATTR_KEYS.has(attr.key) &&
        typeof attr.value.stringValue === "string" &&
        Buffer.byteLength(attr.value.stringValue, "utf8") > IO_PREVIEW_BYTES
      ) {
        const preview = utf8Preview(attr.value.stringValue, IO_PREVIEW_BYTES);
        ioLeanedAttrs.push({ key: attr.key, value: { stringValue: preview } });
        // ADR-022: embed event.id so the read path can JOIN event_log by
        // EventId without guessing. The eventref carries `{field, eventId}`;
        // the read path uses both in `BlobStore.getFromEventLog`.
        eventrefAttrs.push({
          key: `${EVENTREF_ATTR_PREFIX}${attr.key}`,
          value: { stringValue: JSON.stringify({ field: attr.key, eventId: event.id }) },
        });
      } else {
        ioLeanedAttrs.push(attr);
      }
    }

    clonedSpan.attributes = [...ioLeanedAttrs, ...eventrefAttrs];
  }

  // Step 5: Cap non-IO / nested / binary values on the cloned span.
  // IO attrs are already ≤ IO_PREVIEW_BYTES (64 KB) < DEFAULT_MAX (256 KB), so they are untouched.
  capOversizedAttributes(clonedSpan, clonedResource);

  return {
    ...event,
    data: {
      ...data,
      span: clonedSpan,
      resource: clonedResource,
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
    Buffer.byteLength(data.body, "utf8") <= IO_PREVIEW_BYTES
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
        // ADR-022: embed event.id so the read path can resolve via event_log.
        [eventrefKey]: JSON.stringify({ field: "body", eventId: event.id }),
      },
    },
  };
}
