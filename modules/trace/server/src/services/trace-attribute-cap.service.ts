/**
 * Caps oversized attribute values at ingestion to keep Redis fold state small
 * and prevent throughput collapse. Acts as backstop for edge media extraction
 * failures, projects with extraction disabled, and non-media oversized values.
 */
import type { OtlpAnyValue, OtlpResource, OtlpSpan } from "@langwatch/trace-contract";
import { DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES } from "../rules/trace-payload-cap.rules.ts";

type AttributeList = OtlpSpan["attributes"];

// Read-only probe pair: `valueExceeds` and `hasOversizedAttribute` must mirror
// the mutating pair's traversal shape to stay enforceable when one changes.

/**
 * The size ceiling an attribute is held to before storage. Capping replaces
 * an oversized value with a placeholder that SAYS it was truncated — a
 * silent shortening would be indistinguishable from what the customer sent.
 */
export class TraceAttributeCapService {
  private constructor() {}

  static create(): TraceAttributeCapService {
    return new TraceAttributeCapService();
  }

  /** UTF-8 byte length of a string, without allocating a Buffer copy. */
  private utf8ByteLength(value: string): number {
    return Buffer.byteLength(value, "utf8");
  }

  /**
   * Pulls a mime type out of a `data:<mime>;base64,...` URL so the placeholder
   * can name what was cut. Returns null for non-data-url strings.
   */
  private dataUrlMimeType(value: string): string | null {
    if (!value.startsWith("data:")) {
      return null;
    }

    const commaIdx = value.indexOf(",");
    if (commaIdx === -1) {
      return null;
    }

    const header = value.slice(5, commaIdx); // strip "data:"
    const semiIdx = header.indexOf(";");
    const mimeType = semiIdx === -1 ? header : header.slice(0, semiIdx);

    return mimeType || null;
  }

  private truncationPlaceholder(byteSize: number, mimeType: string | null): string {
    return mimeType
      ? `[truncated: ${byteSize} bytes, ${mimeType}]`
      : `[truncated: ${byteSize} bytes]`;
  }

  /**
   * Caps a single OTLP AnyValue in place. Recurses into arrays/kvlists so
   * nested blobs are caught too; returns true when something was replaced.
   */
  /** The string half: an over-large `stringValue` becomes the placeholder. */
  private capStringValue(value: OtlpAnyValue, maxBytes: number): boolean {
    if (typeof value.stringValue !== "string") {
      return false;
    }

    const byteSize = this.utf8ByteLength(value.stringValue);
    if (byteSize <= maxBytes) {
      return false;
    }

    value.stringValue = this.truncationPlaceholder(
      byteSize,
      this.dataUrlMimeType(value.stringValue),
    );

    return true;
  }

  /**
   * The binary half: the payload is replaced with a text placeholder, since downstream consumers
   * read this attribute as a value type and a stringValue is the safe, readable substitute.
   */
  private capBytesValue(value: OtlpAnyValue, maxBytes: number): boolean {
    if (value.bytesValue == null) {
      return false;
    }

    const byteSize =
      value.bytesValue instanceof Uint8Array
        ? value.bytesValue.byteLength
        : // JSON-serialized bytes ({"0":1,...}) or unexpected shape: best-effort size.
          this.utf8ByteLength(String(value.bytesValue));
    if (byteSize <= maxBytes) {
      return false;
    }

    value.bytesValue = null;
    value.stringValue = this.truncationPlaceholder(byteSize, null);

    return true;
  }

  /** Caps every value nested inside an `arrayValue` or a `kvlistValue`. */
  private capNestedValues(value: OtlpAnyValue, maxBytes: number): boolean {
    let capped = false;

    if (value.arrayValue && Array.isArray(value.arrayValue.values)) {
      for (const item of value.arrayValue.values) {
        if (this.capAnyValue(item, maxBytes)) {
          capped = true;
        }
      }
    }

    if (value.kvlistValue && Array.isArray(value.kvlistValue.values)) {
      for (const entry of value.kvlistValue.values) {
        if (entry?.value && this.capAnyValue(entry.value, maxBytes)) {
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
  private capAnyValue(value: OtlpAnyValue, maxBytes: number): boolean {
    if (value == null || typeof value !== "object") {
      return false;
    }

    const cappedString = this.capStringValue(value, maxBytes);
    const cappedBytes = this.capBytesValue(value, maxBytes);
    const cappedNested = this.capNestedValues(value, maxBytes);

    return cappedString || cappedBytes || cappedNested;
  }

  /** Caps every value in an attribute list in place. */
  private capAttributeList(attributes: AttributeList, maxBytes: number): number {
    if (!Array.isArray(attributes)) {
      return 0;
    }

    let count = 0;
    for (const attr of attributes) {
      if (attr?.value && this.capAnyValue(attr.value, maxBytes)) {
        count++;
      }
    }

    return count;
  }

  /** Whether a leaf string or byte payload on this value is over `maxBytes`. */
  private leafExceeds(value: OtlpAnyValue, maxBytes: number): boolean {
    const stringExceeds =
      typeof value.stringValue === "string" && this.utf8ByteLength(value.stringValue) > maxBytes;
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
  private nestedExceeds(value: OtlpAnyValue, maxBytes: number): boolean {
    if (value.arrayValue && Array.isArray(value.arrayValue.values)) {
      for (const item of value.arrayValue.values) {
        if (this.valueExceeds(item, maxBytes)) {
          return true;
        }
      }
    }

    if (value.kvlistValue && Array.isArray(value.kvlistValue.values)) {
      for (const entry of value.kvlistValue.values) {
        if (entry?.value && this.valueExceeds(entry.value, maxBytes)) {
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
  valueExceeds(value: OtlpAnyValue | null | undefined, maxBytes: number): boolean {
    if (value == null || typeof value !== "object") {
      return false;
    }

    return this.leafExceeds(value, maxBytes) || this.nestedExceeds(value, maxBytes);
  }

  /** Whether any attribute in one list carries a value over `maxBytes`. */
  private anyValueExceeds(
    attributes: readonly { value?: OtlpAnyValue | null }[] | null | undefined,
    maxBytes: number,
  ): boolean {
    if (!Array.isArray(attributes)) {
      return false;
    }

    return attributes.some(
      (attr) => Boolean(attr?.value) && this.valueExceeds(attr.value, maxBytes),
    );
  }

  /**
   * Checks if any attribute exceeds maxBytes across span, events, links, and resource.
   * Use as gate before clone; short-circuits on first over-limit value.
   */
  hasOversizedAttribute(
    span: OtlpSpan,
    resource: OtlpResource | null,
    maxBytes: number = DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
  ): boolean {
    try {
      if (this.anyValueExceeds(span.attributes, maxBytes)) {
        return true;
      }

      for (const event of span.events ?? []) {
        if (this.anyValueExceeds(event.attributes, maxBytes)) {
          return true;
        }
      }

      for (const link of span.links ?? []) {
        if (this.anyValueExceeds(link.attributes, maxBytes)) {
          return true;
        }
      }

      if (resource && this.anyValueExceeds(resource.attributes, maxBytes)) {
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
  capOversizedAttributes(
    span: OtlpSpan,
    resource: OtlpResource | null,
    maxBytes: number = DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
  ): number {
    let count = 0;
    try {
      count += this.capAttributeList(span.attributes, maxBytes);
      for (const event of span.events ?? []) {
        count += this.capAttributeList(event.attributes, maxBytes);
      }

      for (const link of span.links ?? []) {
        count += this.capAttributeList(link.attributes, maxBytes);
      }

      if (resource) {
        count += this.capAttributeList(resource.attributes, maxBytes);
      }
    } catch {
      // Degraded, not broken: never block ingestion on a malformed value.
    }

    return count;
  }
}
