import type { OtlpSpan } from "@langwatch/trace-contract";

/** Model name extraction in caller-given priority order. Token estimation and
 * cost enrichment disagree on priority; shared as service to avoid drift. */
export class SpanModelNameService {
  static create(): SpanModelNameService {
    return new SpanModelNameService();
  }

  private constructor() {}

  /**
   * The first non-empty string value found at any of the provided attribute
   * keys, in priority order. Null when no key matches.
   */
  findModelName(span: OtlpSpan, attributeKeys: readonly string[]): string | null {
    for (const key of attributeKeys) {
      for (const attr of span.attributes) {
        if (attr.key !== key) {
          continue;
        }

        const { stringValue } = attr.value;
        if (typeof stringValue === "string" && stringValue.length > 0) {
          return stringValue;
        }
      }
    }

    return null;
  }
}
