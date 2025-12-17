import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";
import { ATTR_KEYS } from "./_constants";

/**
 * Extracts canonical attributes from LangWatch-native spans.
 * 
 * Handles passthrough and normalization of LangWatch-specific attributes:
 * - `langwatch.span.type` - explicit type (highest precedence)
 * - `langwatch.rag.contexts` / `langwatch.rag_contexts` - RAG contexts (accepts both spellings)
 * - `langwatch.params` - request parameters
 * - `langwatch.input` / `langwatch.output` - input/output (flattens single-element arrays)
 * 
 * This extractor runs first in the pipeline and handles LangWatch's own attribute format.
 * 
 * @example
 * ```typescript
 * const extractor = new LangWatchExtractor();
 * extractor.apply(ctx);
 * ```
 */
export class LangWatchExtractor implements CanonicalAttributesExtractor {
  readonly id = "langwatch";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    // explicit type (highest precedence)
    const t = attrs.get(ATTR_KEYS.SPAN_TYPE);
    if (typeof t === "string" && t.length > 0) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, t);
      ctx.recordRule(`${this.id}:span.type`);
    }

    // rag contexts (accept both spellings)
    const rag =
      attrs.take(ATTR_KEYS.LANGWATCH_RAG_CONTEXTS) ??
      attrs.take(ATTR_KEYS.LANGWATCH_RAG_CONTEXTS_LEGACY);
    if (rag !== void 0) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_RAG_CONTEXTS, rag);
      ctx.recordRule(`${this.id}:rag.contexts`);
    }

    // params passthrough (already computed upstream sometimes)
    const params = attrs.take(ATTR_KEYS.LANGWATCH_PARAMS);
    if (params !== void 0) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_PARAMS, params);
      ctx.recordRule(`${this.id}:params`);
    }

    // input/output passthrough (legacy flatten single-element arrays)
    const input = attrs.take(ATTR_KEYS.LANGWATCH_INPUT);
    if (input !== void 0) {
      const v = Array.isArray(input) && input.length === 1 ? input[0] : input;

      ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, v);
      ctx.recordRule(`${this.id}:input`);
    }

    const output = attrs.take(ATTR_KEYS.LANGWATCH_OUTPUT);
    if (output !== void 0) {
      const v =
        Array.isArray(output) && output.length === 1 ? output[0] : output;
      ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, v);
      ctx.recordRule(`${this.id}:output`);
    }
  }
}
