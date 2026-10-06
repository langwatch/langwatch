/**
 * Caps oversized attribute values at ingestion to keep Redis fold state small and prevent
 * throughput collapse. Capping replaces an oversized value with a placeholder that SAYS it was
 * truncated: a silent shortening would be indistinguishable from what the customer sent.
 */
import type { OtlpAnyValue, OtlpResource, OtlpSpan } from "@langwatch/trace-contract";

import { DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES } from "../rules/trace-payload-cap.rules.ts";

type AttributeList = OtlpSpan["attributes"];

type TrimmedHistory = { kind: "trimmed"; value: string } | { kind: "untrimmable" };

const UNTRIMMABLE: TrimmedHistory = { kind: "untrimmable" };

// Read-only probe pair: `valueExceeds` and `hasOversizedAttribute` must mirror
// the mutating pair's traversal shape to stay enforceable when one changes.

/** UTF-8 byte length of a string, without allocating a Buffer copy. */
function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Pulls a mime type out of a `data:<mime>;base64,...` URL so the placeholder
 * can name what was cut. Empty for non-data-url strings.
 */
function dataUrlMimeType(value: string): string {
  if (!value.startsWith("data:")) {
    return "";
  }

  const commaIdx = value.indexOf(",");
  if (commaIdx === -1) {
    return "";
  }

  const header = value.slice(5, commaIdx); // strip "data:"
  const semiIdx = header.indexOf(";");
  const mimeType = semiIdx === -1 ? header : header.slice(0, semiIdx);

  return mimeType;
}

function truncationPlaceholder(byteSize: number, mimeType: string): string {
  return mimeType
    ? `[truncated: ${byteSize} bytes, ${mimeType}]`
    : `[truncated: ${byteSize} bytes]`;
}

/**
 * Caps a single OTLP AnyValue in place. Recurses into arrays/kvlists so
 * nested blobs are caught too; returns true when something was replaced.
 */
/** The string half: an over-large `stringValue` becomes the placeholder. */
function capStringValue(value: OtlpAnyValue, maxBytes: number): boolean {
  if (typeof value.stringValue !== "string") {
    return false;
  }

  const byteSize = utf8ByteLength(value.stringValue);
  if (byteSize <= maxBytes) {
    return false;
  }

  const trimmedHistory = messageHistoryWithinCap(value.stringValue, maxBytes);
  value.stringValue =
    trimmedHistory.kind === "trimmed"
      ? trimmedHistory.value
      : truncationPlaceholder(byteSize, dataUrlMimeType(value.stringValue));

  return true;
}

/**
 * An oversized message history with whole middle messages dropped, keeping
 * the system prompt, the first user message and the latest, counted by a
 * marker. Untrimmable for a non-list or a latest message alone over the cap.
 * @see specs/trace-processing/oversized-attribute-value-preview.feature
 */
function messageHistoryWithinCap(value: string, maxBytes: number): TrimmedHistory {
  const first = value.trimStart()[0];
  if (first !== "[" && first !== "{") return UNTRIMMABLE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return UNTRIMMABLE;
  }
  const located = locateMessages(parsed);
  if (located.kind === "not-a-message-list") return UNTRIMMABLE;
  const { messages, rewrap } = located;
  const headLength = openingLength(messages);
  const head = messages.slice(0, headLength);
  const tail = messages.slice(headLength);
  const fits = (kept: unknown[]) => utf8ByteLength(JSON.stringify(rewrap(kept))) <= maxBytes;
  const build = (prefix: unknown[], keptTail: number) => {
    const dropped = messages.length - prefix.length - keptTail;
    return [
      ...prefix,
      markerMessage({ like: messages[0], dropped, maxBytes }),
      ...tail.slice(tail.length - keptTail),
    ];
  };
  for (const prefix of [head, []]) {
    const keptTail = largestFitting({
      max: tail.length,
      fits: (n) => n > 0 && fits(build(prefix, n)),
    });
    if (keptTail > 0)
      return { kind: "trimmed", value: JSON.stringify(rewrap(build(prefix, keptTail))) };
  }
  return UNTRIMMABLE;
}

/**
 * The binary half: the payload is replaced with a text placeholder, since downstream consumers
 * read this attribute as a value type and a stringValue is the safe, readable substitute.
 */
function capBytesValue(value: OtlpAnyValue, maxBytes: number): boolean {
  if (value.bytesValue == null) {
    return false;
  }

  const byteSize =
    value.bytesValue instanceof Uint8Array
      ? value.bytesValue.byteLength
      : // JSON-serialized bytes ({"0":1,...}) or unexpected shape: best-effort size.
        utf8ByteLength(String(value.bytesValue));
  if (byteSize <= maxBytes) {
    return false;
  }

  value.bytesValue = null;
  value.stringValue = truncationPlaceholder(byteSize, "");

  return true;
}

/** Caps every value nested inside an `arrayValue` or a `kvlistValue`. */
function capNestedValues(value: OtlpAnyValue, maxBytes: number): boolean {
  let capped = false;

  if (value.arrayValue && Array.isArray(value.arrayValue.values)) {
    for (const item of value.arrayValue.values) {
      if (capAnyValue(item, maxBytes)) {
        capped = true;
      }
    }
  }

  if (value.kvlistValue && Array.isArray(value.kvlistValue.values)) {
    for (const entry of value.kvlistValue.values) {
      if (entry?.value && capAnyValue(entry.value, maxBytes)) {
        capped = true;
      }
    }
  }

  return capped;
}

/**
 * Caps a single OTLP AnyValue in place. Returns true when something was
 * replaced (used only for bookkeeping / tests). Recurses into arrays and
 * kvlists so blobs nested inside structured params are caught too.
 */
function capAnyValue(value: OtlpAnyValue, maxBytes: number): boolean {
  if (value == null || typeof value !== "object") {
    return false;
  }

  const cappedString = capStringValue(value, maxBytes);
  const cappedBytes = capBytesValue(value, maxBytes);
  const cappedNested = capNestedValues(value, maxBytes);

  return cappedString || cappedBytes || cappedNested;
}

/** Caps every value in an attribute list in place. */
function capAttributeList(attributes: AttributeList, maxBytes: number): number {
  if (!Array.isArray(attributes)) {
    return 0;
  }

  let count = 0;
  for (const attr of attributes) {
    if (attr?.value && capAnyValue(attr.value, maxBytes)) {
      count++;
    }
  }

  return count;
}

/** Whether a leaf string or byte payload on this value is over `maxBytes`. */
function leafExceeds(value: OtlpAnyValue, maxBytes: number): boolean {
  const stringExceeds =
    typeof value.stringValue === "string" && utf8ByteLength(value.stringValue) > maxBytes;
  if (stringExceeds) {
    return true;
  }

  if (value.bytesValue == null) {
    return false;
  }

  const byteSize =
    value.bytesValue instanceof Uint8Array
      ? value.bytesValue.byteLength
      : Buffer.byteLength(String(value.bytesValue), "utf8");

  return byteSize > maxBytes;
}

/** Whether anything nested inside an `arrayValue` or `kvlistValue` is over `maxBytes`. */
function nestedExceeds(value: OtlpAnyValue, maxBytes: number): boolean {
  if (value.arrayValue && Array.isArray(value.arrayValue.values)) {
    for (const item of value.arrayValue.values) {
      if (valueExceeds(item, maxBytes)) {
        return true;
      }
    }
  }

  if (value.kvlistValue && Array.isArray(value.kvlistValue.values)) {
    for (const entry of value.kvlistValue.values) {
      if (entry?.value && valueExceeds(entry.value, maxBytes)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Read-only recursive size probe: true iff any `stringValue`/`bytesValue`
 * (incl. nested `arrayValue`/`kvlistValue`) exceeds `maxBytes`. Allocates
 * nothing, never throws, short-circuits on the first over-limit value.
 */
export function valueExceeds(value: OtlpAnyValue | null | undefined, maxBytes: number): boolean {
  if (value == null || typeof value !== "object") {
    return false;
  }

  return leafExceeds(value, maxBytes) || nestedExceeds(value, maxBytes);
}

/** Whether any attribute in one list carries a value over `maxBytes`. */
function anyValueExceeds(
  attributes: readonly { value?: OtlpAnyValue | null }[] | null | undefined,
  maxBytes: number,
): boolean {
  if (!Array.isArray(attributes)) {
    return false;
  }

  return attributes.some((attr) => Boolean(attr?.value) && valueExceeds(attr.value, maxBytes));
}

/**
 * Checks if any attribute exceeds maxBytes across span, events, links, and resource.
 * Use as gate before clone; short-circuits on first over-limit value.
 */
export function hasOversizedAttribute(
  span: OtlpSpan,
  resource: OtlpResource | null,
  maxBytes: number = DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
): boolean {
  try {
    if (anyValueExceeds(span.attributes, maxBytes)) {
      return true;
    }

    for (const event of span.events ?? []) {
      if (anyValueExceeds(event.attributes, maxBytes)) {
        return true;
      }
    }

    for (const link of span.links ?? []) {
      if (anyValueExceeds(link.attributes, maxBytes)) {
        return true;
      }
    }

    if (resource && anyValueExceeds(resource.attributes, maxBytes)) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Walks span/events/links/resource and replaces oversized attribute values with
 * placeholders. Safe for hot ingestion: never throws, returns count for logging.
 */
export function capOversizedAttributes(
  span: OtlpSpan,
  resource: OtlpResource | null,
  maxBytes: number = DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
): number {
  let count = 0;
  try {
    count += capAttributeList(span.attributes, maxBytes);
    for (const event of span.events ?? []) {
      count += capAttributeList(event.attributes, maxBytes);
    }

    for (const link of span.links ?? []) {
      count += capAttributeList(link.attributes, maxBytes);
    }

    if (resource) {
      count += capAttributeList(resource.attributes, maxBytes);
    }
  } catch {
    // Degraded, not broken: never block ingestion on a malformed value.
    return count;
  }

  return count;
}

type Message = Record<string, unknown>;

const isMessage = (item: unknown): item is Message =>
  typeof item === "object" && item !== null && typeof (item as Message).role === "string";

type LocatedMessages =
  | { kind: "message-list"; messages: Message[]; rewrap: (kept: unknown[]) => unknown }
  | { kind: "not-a-message-list" };

const NOT_A_MESSAGE_LIST: LocatedMessages = { kind: "not-a-message-list" };

/** The message list inside a value, bare or under `value`/`messages`, and how to put it back. */
function locateMessages(parsed: unknown): LocatedMessages {
  if (Array.isArray(parsed) && parsed.length > 1 && parsed.every(isMessage)) {
    return { kind: "message-list", messages: parsed, rewrap: (kept) => kept };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return NOT_A_MESSAGE_LIST;
  }
  for (const key of ["value", "messages"]) {
    const inner = (parsed as Record<string, unknown>)[key];
    if (Array.isArray(inner) && inner.length > 1 && inner.every(isMessage)) {
      return {
        kind: "message-list",
        messages: inner,
        rewrap: (kept) => ({ ...parsed, [key]: kept }),
      };
    }
  }
  return NOT_A_MESSAGE_LIST;
}

/** The leading system messages and the first message after them. */
function openingLength(messages: Message[]): number {
  let index = 0;
  while (index < messages.length - 1 && messages[index]!.role === "system") index++;
  return Math.min(index + 1, messages.length - 1);
}

/** A system message counting the dropped ones, in the shape the list's messages use. */
function markerMessage({
  like,
  dropped,
  maxBytes,
}: {
  like: unknown;
  dropped: number;
  maxBytes: number;
}): Message {
  const text = `[${dropped} messages omitted to fit the ${maxBytes}-byte attribute cap]`;
  const usesParts = isMessage(like) && Array.isArray(like.parts) && like.content === undefined;
  return usesParts
    ? { role: "system", parts: [{ type: "text", content: text }] }
    : { role: "system", content: text };
}

/** The largest n in 1..max for which `fits(n)` holds, 0 when none does; `fits` is monotone. */
function largestFitting({ max, fits }: { max: number; fits: (n: number) => boolean }): number {
  let low = 0;
  let high = max;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  return low;
}
