import type { OtlpSpan } from "@langwatch/trace-contract";

/**
 * Reading a span's model name off its attributes, in a caller-given priority
 * order.
 *
 * Two record-time passes need this and they disagree about which key wins:
 * token estimation asks for the RESPONSE model first, cost enrichment asks for
 * the REQUEST model first. That disagreement is the honest seam — the order is
 * the caller's decision, the walk is not — and it is why the application shares
 * the walk through a `utils/spanModel` module and passes the key list in. The
 * strict layout has no `utils` directory, so the walk is a service of its own
 * rather than a copy inside each caller, where the two copies could drift while
 * the caller-specific key lists stayed put.
 */
export class SpanModelNameService {
  static create(): SpanModelNameService {
    return new SpanModelNameService();
  }

  private constructor() {}

  /**
   * The first non-empty string value found at any of the provided attribute
   * keys, in priority order. Null when no key matches.
   */
  tryExtractModelName(span: OtlpSpan, attributeKeys: readonly string[]): string | null {
    for (const key of attributeKeys) {
      for (const attr of span.attributes) {
        if (
          attr.key === key &&
          typeof attr.value.stringValue === "string" &&
          attr.value.stringValue.length > 0
        ) {
          return attr.value.stringValue;
        }
      }
    }

    return null;
  }
}
