/**
 * capOversizedAttributes — bounds the byte-size of incoming span attribute
 * values at ingestion, before a span enters the event-sourcing fold state.
 *
 * Why this exists
 * ---------------
 * A small number of pathological traces carry multi-megabyte attribute values:
 * base64-encoded images (`data:image/...;base64,...` data URLs) embedded in
 * multimodal LLM messages on `langwatch.input` / `langwatch.output`, or simply
 * very large `langwatch.params`. The trace-processing pipeline is event
 * sourced: every span becomes a SpanReceivedEvent that is folded into a
 * per-trace fold STATE in Redis via a read-modify-write per event. When that
 * state grows to multiple megabytes, each Redis op saturates the single-
 * threaded command loop, folding throughput collapses, staging outpaces it,
 * and the backlog (and Redis memory) diverges.
 *
 * Capping oversized values here keeps the fold state small (KB, not MB) so
 * folding throughput stays high. This only needs to protect NEW traces.
 *
 * Why a size cap and not blob extraction
 * --------------------------------------
 * The existing `extractInlineMediaFromEvent` blob extractor walks the
 * structured chat `message` / `messages` content-part vocabulary used by the
 * scenario path. In the trace/OTLP path the equivalent payload is a flat,
 * already-serialized JSON string inside an attribute's `stringValue` (or a
 * `bytesValue`), not a structured content array. Reaching the extractor would
 * require speculatively JSON-parsing arbitrary attribute strings in the hottest
 * ingestion path and re-serializing them, which is fragile and CPU-heavy. It
 * also depends on a configured storage driver, which self-hosted deployments
 * may not have. So we cap by size instead: bounded, allocation-light, and
 * never throwing.
 *
 * Behaviour
 * ---------
 * - Walks span / resource attribute values (recursively through arrayValue and
 *   kvlistValue) and replaces any `stringValue` or `bytesValue` whose byte size
 *   exceeds the threshold with a short placeholder describing what was cut.
 * - Normal traces are untouched: only values over the (generous) threshold are
 *   replaced. The walk is in place and degrades gracefully — a malformed value
 *   is left as-is rather than throwing.
 */
import type { OtlpAnyValue, OtlpResource, OtlpSpan } from "../schemas/otlp";

/**
 * Generous threshold (256KB). Real-world text input/output is far smaller; this
 * only trips on embedded binary blobs (base64 images/audio) and pathologically
 * large payloads.
 */
export const DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES = 256 * 1024;

/** UTF-8 byte length of a string, without allocating a Buffer copy. */
function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Pulls a mime type out of a `data:<mime>;base64,...` URL so the placeholder
 * can name what was cut. Returns null for non-data-url strings.
 */
function dataUrlMimeType(value: string): string | null {
  if (!value.startsWith("data:")) return null;
  const commaIdx = value.indexOf(",");
  if (commaIdx === -1) return null;
  const header = value.slice(5, commaIdx); // strip "data:"
  const semiIdx = header.indexOf(";");
  const mimeType = semiIdx === -1 ? header : header.slice(0, semiIdx);
  return mimeType || null;
}

function truncationPlaceholder(
  byteSize: number,
  mimeType: string | null,
): string {
  return mimeType
    ? `[truncated: ${byteSize} bytes, ${mimeType}]`
    : `[truncated: ${byteSize} bytes]`;
}

/**
 * Caps a single OTLP AnyValue in place. Returns true when something was
 * replaced (used only for bookkeeping / tests). Recurses into arrays and
 * kvlists so blobs nested inside structured params are caught too.
 */
function capAnyValue(value: OtlpAnyValue, maxBytes: number): boolean {
  if (value == null || typeof value !== "object") return false;

  let capped = false;

  if (typeof value.stringValue === "string") {
    const byteSize = utf8ByteLength(value.stringValue);
    if (byteSize > maxBytes) {
      value.stringValue = truncationPlaceholder(
        byteSize,
        dataUrlMimeType(value.stringValue),
      );
      capped = true;
    }
  }

  if (value.bytesValue != null) {
    const byteSize =
      value.bytesValue instanceof Uint8Array
        ? value.bytesValue.byteLength
        : // JSON-serialized bytes ({"0":1,...}) or unexpected shape: best-effort size.
          utf8ByteLength(String(value.bytesValue));
    if (byteSize > maxBytes) {
      // Replace the binary payload with a text placeholder. Downstream
      // consumers read this attribute as a value type, so a stringValue
      // placeholder is the safe, readable substitute.
      value.bytesValue = null;
      value.stringValue = truncationPlaceholder(byteSize, null);
      capped = true;
    }
  }

  if (value.arrayValue && Array.isArray(value.arrayValue.values)) {
    for (const item of value.arrayValue.values) {
      if (capAnyValue(item, maxBytes)) capped = true;
    }
  }

  if (value.kvlistValue && Array.isArray(value.kvlistValue.values)) {
    for (const entry of value.kvlistValue.values) {
      if (entry?.value && capAnyValue(entry.value, maxBytes)) capped = true;
    }
  }

  return capped;
}

type AttributeList = OtlpSpan["attributes"];

/** Caps every value in an attribute list in place. */
function capAttributeList(attributes: AttributeList, maxBytes: number): number {
  if (!Array.isArray(attributes)) return 0;
  let count = 0;
  for (const attr of attributes) {
    if (attr?.value && capAnyValue(attr.value, maxBytes)) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Read-only probe pair
// ---------------------------------------------------------------------------
// NOTE: `valueExceeds` and `hasOversizedAttribute` below form a read-only
// probe pair whose traversal MUST stay identical to `capAnyValue` /
// `capOversizedAttributes` above. Colocating them here makes that trivially
// enforceable — any change to the mutating pair should be mirrored in the
// probe pair, and vice versa.

/**
 * Read-only recursive size probe. Returns true iff any `stringValue` or
 * `bytesValue` in `value` (or nested inside `arrayValue`/`kvlistValue`)
 * exceeds `maxBytes`. Allocates nothing, never throws, short-circuits on the
 * first over-limit value.
 *
 * Mirrors the traversal shape of `capAnyValue` exactly.
 */
export function valueExceeds(
  value: OtlpAnyValue | null | undefined,
  maxBytes: number,
): boolean {
  if (value == null || typeof value !== "object") return false;

  if (typeof value.stringValue === "string") {
    if (utf8ByteLength(value.stringValue) > maxBytes) return true;
  }

  if (value.bytesValue != null) {
    const byteSize =
      value.bytesValue instanceof Uint8Array
        ? value.bytesValue.byteLength
        : Buffer.byteLength(String(value.bytesValue), "utf8");
    if (byteSize > maxBytes) return true;
  }

  if (value.arrayValue && Array.isArray(value.arrayValue.values)) {
    for (const item of value.arrayValue.values) {
      if (valueExceeds(item, maxBytes)) return true;
    }
  }

  if (value.kvlistValue && Array.isArray(value.kvlistValue.values)) {
    for (const entry of value.kvlistValue.values) {
      if (entry?.value && valueExceeds(entry.value, maxBytes)) return true;
    }
  }

  return false;
}

/**
 * Returns true iff any attribute value exceeds `maxBytes` across the SAME
 * surfaces that `capOversizedAttributes` walks: `span.attributes`,
 * `span.events[].attributes`, `span.links[].attributes`, and
 * `resource?.attributes`.
 *
 * Use as the gate before a structuredClone / `capOversizedAttributes` call.
 * Never throws (mirrors `capOversizedAttributes`' defensive try/catch).
 * Short-circuits on the first over-limit value.
 */
export function hasOversizedAttribute(
  span: OtlpSpan,
  resource: OtlpResource | null,
  maxBytes: number = DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
): boolean {
  try {
    if (Array.isArray(span.attributes)) {
      for (const attr of span.attributes) {
        if (attr?.value && valueExceeds(attr.value, maxBytes)) return true;
      }
    }
    for (const event of span.events ?? []) {
      if (Array.isArray(event.attributes)) {
        for (const attr of event.attributes) {
          if (attr?.value && valueExceeds(attr.value, maxBytes)) return true;
        }
      }
    }
    for (const link of span.links ?? []) {
      if (Array.isArray(link.attributes)) {
        for (const attr of link.attributes) {
          if (attr?.value && valueExceeds(attr.value, maxBytes)) return true;
        }
      }
    }
    if (resource && Array.isArray(resource.attributes)) {
      for (const attr of resource.attributes) {
        if (attr?.value && valueExceeds(attr.value, maxBytes)) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Walks a span (and its events, links, and the shared resource) and replaces
 * any attribute value over `maxBytes` with a short placeholder, in place.
 *
 * Safe for the hot ingestion path: never throws, only touches values that
 * exceed the threshold, and leaves normal spans byte-for-byte unchanged.
 *
 * Returns the number of values capped (for logging / tests).
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
  }
  return count;
}
