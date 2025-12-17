import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";
import { ALLOWED_SPAN_TYPES } from "./_helpers";
import { ATTR_KEYS } from "./_constants";

/**
 * Extracts canonical attributes from OpenInference spans.
 *
 * Handles:
 * - `openinference.span.kind` → `langwatch.span.type`
 *
 * Only sets type if not already explicitly set and the kind is in the allowed set.
 *
 * @example
 * ```typescript
 * const extractor = new OpenInferenceExtractor();
 * extractor.apply(ctx);
 * ```
 */
export class OpenInferenceExtractor implements CanonicalAttributesExtractor {
  readonly id = "openinference";

  apply(ctx: ExtractorContext): void {
    const explicit = ctx.bag.attrs.get(ATTR_KEYS.SPAN_TYPE);
    if (typeof explicit === "string" && ALLOWED_SPAN_TYPES.has(explicit)) return;

    const raw = ctx.bag.attrs.take(ATTR_KEYS.OPENINFERENCE_SPAN_KIND);
    const kind = typeof raw === "string" ? raw.toLowerCase() : null;
    if (!kind || !ALLOWED_SPAN_TYPES.has(kind)) return;

    ctx.setAttr(ATTR_KEYS.SPAN_TYPE, kind);
    ctx.recordRule(`${this.id}:openinference.span.kind->langwatch.span.type`);
  }
}
