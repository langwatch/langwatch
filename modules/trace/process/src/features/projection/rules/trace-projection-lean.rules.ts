/**
 * Frozen twin of the application's own `lean-for-projection` (ADR-022): edit neither without the
 * other. The lean is projection-payload policy and must be the same transform at live dispatch and
 * at replay, or replay rebuilds a projection the live path would never have written.
 */

import type { ReplayEventLean } from "@langwatch/eventing/server";
import type { OtlpResource, OtlpSpan } from "@langwatch/otlp/trace-request";
import { DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES } from "@langwatch/span-normalisation";
import {
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  serializeTraceEventReference,
  SPAN_RECEIVED_EVENT_TYPE,
  traceEventReferenceKey,
} from "@langwatch/trace-contract";

import { clonePayload } from "../../../rules/payload-clone.rules.ts";
import {
  capOversizedAttributes,
  hasOversizedAttribute,
} from "../../../rules/trace-attribute-cap.rules.ts";

type LeanableEvent = { id: string; type: string; data: unknown };

/**
 * Preview budget for IO attributes. Covers a complete chat-style Claude completion at
 * the common max_tokens=8192 setting (~16K tokens × 4 chars/token ≈ 64 KB).
 * Configurable via `LANGWATCH_IO_PREVIEW_BYTES`.
 */
export const IO_PREVIEW_BYTES = 64 * 1024;

/**
 * Span attribute keys that are previewed past IO_PREVIEW_BYTES. Any other top-level string is
 * previewed past DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES; both keep an eventref to the full value.
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
      ? utf8Preview(value, PREVIEW_STRING_CLAMP_BYTES)
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
 * Leans a SpanReceived event: oversized top-level text becomes a preview with an eventref, then
 * what is left oversized (binary, nested, events, links, resource) is capped without one. The
 * scan runs before anything is allocated, so the sub-threshold path stays allocation-free.
 */
function leanSpanReceivedEvent(event: LeanableEvent): LeanableEvent {
  const data = event.data as { span?: OtlpSpan; resource?: OtlpResource | null };
  // A test event with empty data has no span at all; pass it through unchanged.
  if (!data?.span) {
    return event;
  }

  // Scan only, before anything is allocated: does any attribute need a preview, and does any
  // surface the cap walks need the cap?
  const hasOffloadable = (data.span.attributes ?? []).some(isOffloadableAttribute);
  const needsNonIoCap = hasOversizedAttribute(
    data.span,
    data.resource ?? null,
    DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
  );
  if (!hasOffloadable && !needsNonIoCap) {
    return event;
  }

  // Deep-clone so the IO-lean pass and the cap both operate on independent copies, with no shared
  // object references left back to the input event.
  const clonedSpan: OtlpSpan = clonePayload(data.span);
  const clonedResource: OtlpResource | null = data.resource ? clonePayload(data.resource) : null;
  if (hasOffloadable) {
    clonedSpan.attributes = leanOffloadableAttributes({
      attributes: clonedSpan.attributes,
      eventId: event.id,
    });
  }

  // Previewed attributes are already under the cap, so it never touches them.
  capOversizedAttributes(clonedSpan, clonedResource);

  return { ...event, data: { ...data, span: clonedSpan, resource: clonedResource } };
}

/** A base64 data URL: a preview of it has nothing to read, so the cap replaces it instead. */
const BASE64_DATA_URL = /^data:[^,]*;base64,/;

/**
 * A top-level string attribute past its preview budget: IO keys past IO_PREVIEW_BYTES, any other
 * text past DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES. Base64 data URLs outside IO keys stay with the cap.
 */
function isOffloadableAttribute(attr: OtlpSpan["attributes"][number]): boolean {
  const value = attr.value.stringValue;
  if (typeof value !== "string") return false;
  if (IO_ATTR_KEYS.has(attr.key)) return Buffer.byteLength(value, "utf8") > IO_PREVIEW_BYTES;
  return (
    Buffer.byteLength(value, "utf8") > DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES &&
    !BASE64_DATA_URL.test(value)
  );
}

/**
 * The span's attributes with every offloadable value replaced by a preview and followed by its
 * eventref. The structure-preserving preview is tried first, so a JSON chat payload stays valid
 * JSON under the budget and the fold still extracts real text; the byte cut is the fallback.
 */
function leanOffloadableAttributes({
  attributes,
  eventId,
}: {
  attributes: OtlpSpan["attributes"];
  eventId: string;
}): OtlpSpan["attributes"] {
  const leaned: OtlpSpan["attributes"] = [];
  const eventrefs: OtlpSpan["attributes"] = [];
  for (const attr of attributes) {
    if (!isOffloadableAttribute(attr)) {
      leaned.push(attr);
      continue;
    }

    const value = attr.value.stringValue as string;
    const preview =
      buildStructuredIoPreview(value, IO_PREVIEW_BYTES) ?? utf8Preview(value, IO_PREVIEW_BYTES);
    leaned.push({ key: attr.key, value: { stringValue: preview } });
    // ADR-022: the eventref carries the field and the event id, which is what the read path joins
    // event_log on rather than guessing.
    eventrefs.push({
      key: traceEventReferenceKey(attr.key),
      value: {
        stringValue: serializeTraceEventReference({ field: attr.key, eventId }),
      },
    });
  }

  return [...leaned, ...eventrefs];
}

/**
 * Leans a LogRecordReceived event by truncating the body if it exceeds IO_PREVIEW_BYTES
 * and attaching an eventref pointer in the event's attributes.
 */
function leanLogRecordReceivedEvent(event: LeanableEvent): LeanableEvent {
  const data = event.data as {
    body: string;
    attributes?: Record<string, string>;
  };

  if (typeof data.body !== "string" || Buffer.byteLength(data.body, "utf8") <= IO_PREVIEW_BYTES) {
    return event;
  }

  const preview = utf8Preview(data.body, IO_PREVIEW_BYTES);
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

/** UTF-8-safe truncation to at most `maxBytes`, backing off to a codepoint boundary. */
export function utf8Preview(value: string, maxBytes: number): string {
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
 * Structure-preserving preview for an over-budget IO attribute holding JSON, since a blind byte
 * cut turns a chat-messages array into unparseable JSON. Long string leaves are clamped, then
 * middle array items dropped; anything still too big reports null and the caller byte-cuts.
 */
export function buildStructuredIoPreview(value: string, maxBytes: number): string | null {
  if (Buffer.byteLength(value, "utf8") > PREVIEW_MAX_SOURCE_BYTES) {
    return null;
  }

  const trimmed = value.trim();
  const looksLikeJson = trimmed.startsWith("[") || trimmed.startsWith("{");
  if (!looksLikeJson) {
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
 * Rewrites over-threshold IO attribute values to a preview with a reserved eventref pointer, on
 * SpanReceived per IO attribute and on LogRecordReceived per body. The returned event shares no
 * references with the input, so leaned mutations never ripple back to event_log.
 */
export function leanForProjection<EventType extends LeanableEvent>(event: EventType): EventType;

export function leanForProjection(event: LeanableEvent): LeanableEvent {
  if (event.type === SPAN_RECEIVED_EVENT_TYPE) {
    return leanSpanReceivedEvent(event);
  }

  if (event.type === LOG_RECORD_RECEIVED_EVENT_TYPE) {
    return leanLogRecordReceivedEvent(event);
  }

  return event;
}

/** @see ADR-022: the replay source leans with the same transform as live dispatch. */
export const leanReplayEvent: ReplayEventLean = (event) => leanForProjection(event);
