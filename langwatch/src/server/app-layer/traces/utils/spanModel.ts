import type { OtlpSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";

/**
 * Returns the first non-empty string value found at any of the provided
 * attribute keys, in priority order. Returns null when no key matches.
 *
 * Used to read a span's model name out of differently-named attributes
 * (`gen_ai.request.model`, `gen_ai.response.model`, `llm.model_name`,
 * `ai.model`). Callers pass their own key priority because cost
 * enrichment prefers `request` while token estimation prefers `response`.
 */
export function extractModelName(
  span: OtlpSpan,
  attributeKeys: readonly string[],
): string | null {
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
