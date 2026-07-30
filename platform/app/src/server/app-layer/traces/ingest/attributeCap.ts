import type { OtlpAnyValue, OtlpResource, OtlpSpan } from "./otlp";

/**
 * Bounds the byte-size of an incoming span's attribute values before the span
 * is staged. Inline media is normally externalized first by
 * `maybeExtractSpanMedia`; this is the backstop for whatever still arrives
 * oversized — extraction fail-open, projects with extraction off, and
 * genuinely huge non-media values (giant params, embeddings).
 *
 * `valueExceeds`/`hasOversizedAttribute` are the read-only probe pair for
 * `capAnyValue`/`capOversizedAttributes` and MUST walk the same surfaces.
 * Neither ever throws: a malformed value is left as-is.
 */

/** 256KB. Real text IO is far smaller; this trips only on embedded blobs. */
export const DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES = 256 * 1024;

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** Names what was cut, for a `data:<mime>;base64,...` URL. */
function dataUrlMimeType(value: string): string | null {
  if (!value.startsWith("data:")) return null;
  const commaIdx = value.indexOf(",");
  if (commaIdx === -1) return null;
  const header = value.slice(5, commaIdx);
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
        : utf8ByteLength(String(value.bytesValue));
    if (byteSize > maxBytes) {
      // Consumers read this attribute as a value type, so a stringValue
      // placeholder is the safe substitute for the dropped binary payload.
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

function capAttributeList(
  attributes: OtlpSpan["attributes"],
  maxBytes: number,
): number {
  if (!Array.isArray(attributes)) return 0;
  let count = 0;
  for (const attr of attributes) {
    if (attr?.value && capAnyValue(attr.value, maxBytes)) count++;
  }
  return count;
}

function valueExceeds(
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
        : utf8ByteLength(String(value.bytesValue));
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

/** The gate before a structuredClone + `capOversizedAttributes` call. */
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

/** Caps in place and returns how many values were replaced. */
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
