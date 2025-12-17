import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";
import { ALLOWED_SPAN_TYPES, extractInputMessages, extractOutputMessages } from "./_helpers";
import { ATTR_KEYS } from "./_constants";

/**
 * Extracts canonical attributes from Traceloop spans.
 *
 * Handles:
 * - `traceloop.span.kind` → `langwatch.span.type`
 * - `traceloop.entity.input` → `gen_ai.input.messages`
 * - `traceloop.entity.output` → `gen_ai.output.messages`
 *
 * @example
 * ```typescript
 * const extractor = new TraceloopExtractor();
 * extractor.apply(ctx);
 * ```
 */
export class TraceloopExtractor implements CanonicalAttributesExtractor {
  readonly id = "traceloop";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    // type from traceloop.span.kind (don't override explicit)
    if (!attrs.has(ATTR_KEYS.SPAN_TYPE)) {
      const raw = attrs.take(ATTR_KEYS.TRACELOOP_SPAN_KIND);
      const kind = typeof raw === "string" ? raw.toLowerCase() : null;
      if (kind && ALLOWED_SPAN_TYPES.has(kind)) {
        ctx.setAttr(ATTR_KEYS.SPAN_TYPE, kind);
        ctx.recordRule(`${this.id}:span.kind`);
      }
    } else {
      // still consume to reduce leftovers
      attrs.take(ATTR_KEYS.TRACELOOP_SPAN_KIND);
    }

    // input
    extractInputMessages(
      ctx,
      [{ type: "attr", keys: [ATTR_KEYS.TRACELOOP_ENTITY_INPUT] }],
      `${this.id}:entity.input->gen_ai.input.messages`
    );

    // output
    extractOutputMessages(
      ctx,
      [{ type: "attr", keys: [ATTR_KEYS.TRACELOOP_ENTITY_OUTPUT] }],
      `${this.id}:entity.output->gen_ai.output.messages`
    );
  }
}
