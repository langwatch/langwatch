/**
 * FROZEN TWIN of `platform/app/src/server/app-layer/traces/lean-for-projection.ts` (ADR-022) — the application keeps its own copy while both graphs ingest; edit neither without editing the other. The lean is projection-payload POLICY (which attribute keys earn the wide preview budget, how big, how an over-budget value is shaped) and must be the same transform at both call sites — live dispatch (between storeEvents and the router) and replay (at materialization) — or replay rebuilds a projection the live path would never have written. IT LIVES IN THE SERVER, NOT THE CONTRACT: what both offload sides must agree on (the reserved `langwatch.reserved.eventref.` prefix and `{field, eventId}` pointer) is in `@langwatch/trace-contract` (`trace-offload.contract.ts`); the writer's own judgement stands on this package's `TraceAttributeCap` and has one reader (itself), so the contract could not host it without inverting that.
 */

import type { Event } from "@langwatch/eventing";
import {
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  serializeTraceEventReference,
  SPAN_RECEIVED_EVENT_TYPE,
  traceEventReferenceKey,
} from "@langwatch/trace-contract";
import type { OtlpResource, OtlpSpan } from "@langwatch/trace-contract";
import { TraceAttributeCap } from "./trace-attribute-cap.service";
import { DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES } from "../rules/trace-payload-cap.rules";

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
 * Per-string clamp inside a structure-preserving preview. Generous enough to
 * keep any real chat message readable while guaranteeing a single message can
 * never dominate the whole preview budget.
 */
const PREVIEW_STRING_CLAMP_BYTES = 8 * 1024;

/**
 * Ceiling for attempting the structure-preserving preview at all. Parsing a
 * pathological multi-megabyte value (embedded base64 that escaped media
 * extraction) buys nothing — those fall straight through to the byte cut.
 */
const PREVIEW_MAX_SOURCE_BYTES = 2 * 1024 * 1024;

/** Recursion guard for the clamp walk; real payloads never approach it. */
const PREVIEW_MAX_DEPTH = 64;

/**
 * Clamps every over-long string leaf in a parsed JSON value, preserving the
 * surrounding structure. Roles, ids, and short content stay verbatim.
 */
function clampLongStrings(value: unknown, depth = 0): unknown {
  if (depth > PREVIEW_MAX_DEPTH) {
    return value;
  }

  if (typeof value === "string") {
    return Buffer.byteLength(value, "utf8") > PREVIEW_STRING_CLAMP_BYTES
      ? TraceProjectionLeanService.utf8Preview(value, PREVIEW_STRING_CLAMP_BYTES)
      : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => clampLongStrings(item, depth + 1));
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = clampLongStrings(entry, depth + 1);
    }

    return out;
  }

  return value;
}

/**
 * Leans a SpanReceived event: truncates over-threshold IO attributes (> IO_PREVIEW_BYTES) with eventref pointers FIRST, then caps any remaining non-IO/nested/binary values exceeding DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES via `capOversizedAttributes` (IO attrs are already ≤64 KB so the 256 KB cap never touches them; non-IO caps get no eventref, since recovery there is a full event_log read). CLONE SAFETY: the original attributes are scanned first (no allocation) to decide if the heavy path is needed; only then is the span structuredClone'd and re-leaned on the clone, keeping the sub-threshold hot path allocation-free and the input event byte-for-byte untouched.
 */
function leanSpanReceivedEvent(event: Event): Event {
  const data = event.data as {
    span?: OtlpSpan;
    resource?: OtlpResource | null;
  };

  // Guard: if span or attributes are absent (e.g. test events with empty data), pass through unchanged.
  if (!data?.span) {
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
  const needsNonIoCap = TraceAttributeCap.hasOversizedAttribute(
    data.span,
    data.resource ?? null,
    DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
  );

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
        // Prefer the structure-preserving preview: a JSON chat payload stays
        // VALID JSON under the budget so the fold still extracts the real
        // user/assistant text. The byte cut is the fallback for non-JSON.
        const preview =
          TraceProjectionLeanService.tryStructuredIoPreview(
            attr.value.stringValue,
            IO_PREVIEW_BYTES,
          ) ?? TraceProjectionLeanService.utf8Preview(attr.value.stringValue, IO_PREVIEW_BYTES);
        ioLeanedAttrs.push({ key: attr.key, value: { stringValue: preview } });
        // ADR-022: embed event.id so the read path can JOIN event_log by
        // EventId without guessing. The eventref carries `{field, eventId}`;
        // the read path uses both in `TraceBlobStoreService.getFromEventLog`.
        eventrefAttrs.push({
          key: traceEventReferenceKey(attr.key),
          value: {
            stringValue: serializeTraceEventReference({
              field: attr.key,
              eventId: event.id,
            }),
          },
        });
      } else {
        ioLeanedAttrs.push(attr);
      }
    }

    clonedSpan.attributes = [...ioLeanedAttrs, ...eventrefAttrs];
  }

  // Step 5: Cap non-IO / nested / binary values on the cloned span.
  // IO attrs are already ≤ IO_PREVIEW_BYTES (64 KB) < DEFAULT_MAX (256 KB), so they are untouched.
  TraceAttributeCap.capOversizedAttributes(clonedSpan, clonedResource);

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

  if (typeof data.body !== "string" || Buffer.byteLength(data.body, "utf8") <= IO_PREVIEW_BYTES) {
    return event;
  }

  const preview = TraceProjectionLeanService.utf8Preview(data.body, IO_PREVIEW_BYTES);
  const eventrefKey = traceEventReferenceKey("body");

  return {
    ...event,
    data: {
      ...data,
      body: preview,
      attributes: {
        ...data.attributes,
        // ADR-022: embed event.id so the read path can resolve via event_log.
        [eventrefKey]: serializeTraceEventReference({ field: "body", eventId: event.id }),
      },
    },
  };
}

export class TraceProjectionLeanService {
  static create(): TraceProjectionLeanService {
    return new TraceProjectionLeanService();
  }

  /** UTF-8-safe truncation to at most `maxBytes`, backing off to a codepoint boundary. */
  static utf8Preview(value: string, maxBytes: number): string {
    const buf = Buffer.from(value, "utf8");
    if (buf.byteLength <= maxBytes) {
      return value;
    }

    let end = maxBytes;
    // 0b10xxxxxx are UTF-8 continuation bytes — don't cut mid-codepoint.
    while (end > 0 && (buf[end]! & 0xc0) === 0x80) {
      end--;
    }

    return buf.subarray(0, end).toString("utf8") + "…";
  }

  /**
   * Structure-preserving preview for an over-budget IO attribute holding JSON (the shape every gen_ai.input/output.messages value has) — a blind byte cut (`utf8Preview`) turns a chat-messages array into unparseable JSON, degrading everything computed from the leaned span (fold IO, trace list, Summary/Conversation views) to a raw blob; a Langy turn's system prompt alone exceeds 64 KB, so every such turn used to lose its "hi". Strategy, always staying under `maxBytes`: clamp long string leaves to a per-string cap; if still over and the top level is an array, drop MIDDLE items keeping the first message and as much of the TAIL as fits (where IO extraction actually reads); anything still too big reports null and the caller falls back to the byte cut, so this can only ever improve on it. Shapes ONLY the preview — the full value is untouched in event_log.
   */
  static tryStructuredIoPreview(value: string, maxBytes: number): string | null {
    if (Buffer.byteLength(value, "utf8") > PREVIEW_MAX_SOURCE_BYTES) {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }

    if (parsed === null || typeof parsed !== "object") {
      return null;
    }

    const clamped = clampLongStrings(parsed);
    const clampedJson = JSON.stringify(clamped);
    if (Buffer.byteLength(clampedJson, "utf8") <= maxBytes) {
      return clampedJson;
    }

    if (!Array.isArray(clamped)) {
      return null;
    }

    const first = clamped[0];
    const firstSize = Buffer.byteLength(JSON.stringify(first), "utf8");
    // Brackets plus the first item; each kept tail item costs its size plus a comma.
    let budget = maxBytes - firstSize - 2;
    const tail: unknown[] = [];
    for (let i = clamped.length - 1; i >= 1; i--) {
      const cost = Buffer.byteLength(JSON.stringify(clamped[i]), "utf8") + 1;
      if (cost > budget) {
        break;
      }

      tail.unshift(clamped[i]);
      budget -= cost;
    }

    if (tail.length === 0 && clamped.length > 1) {
      return null;
    }

    const preview = JSON.stringify([first, ...tail]);

    return Buffer.byteLength(preview, "utf8") <= maxBytes ? preview : null;
  }

  /**
   * Rewrites over-threshold IO attribute values to a preview (≤ IO_PREVIEW_BYTES) with a `langwatch.reserved.eventref.<attrKey>` pointer `{ field: <attrKey> }`: SpanReceived per over-threshold IO_ATTR_KEYS attr, LogRecordReceived on an over-threshold body (eventref.body), other event types pass through unchanged. Returned event is deeply independent of the input (no shared array references), so leaned mutations never ripple back to event_log.
   * @param event - The event to lean.
   * @returns A new event with IO attributes replaced by previews + eventrefs, or the original if no leaning was necessary.
   */
  static leanForProjection<EventType extends Event>(event: EventType): EventType;

  static leanForProjection(event: Event): Event {
    if (event.type === SPAN_RECEIVED_EVENT_TYPE) {
      return leanSpanReceivedEvent(event);
    }

    if (event.type === LOG_RECORD_RECEIVED_EVENT_TYPE) {
      return leanLogRecordReceivedEvent(event);
    }

    return event;
  }
}
