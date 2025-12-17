import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";
import { safeJsonParse, extractInputMessages, extractOutputMessages, inferSpanTypeIfAbsent } from "./_helpers";
import { ATTR_KEYS } from "./_constants";
import type { NormalizedEvent } from "../../schemas/spans";

/**
 * Extracts canonical attributes from Logfire spans.
 * 
 * Handles:
 * - `raw_input` → `gen_ai.input.messages` (often contains JSON string of messages)
 * - `gen_ai.choice` event → `gen_ai.output.messages`
 * - Infers `langwatch.span.type` as "llm" if `raw_input` is present
 * 
 * @example
 * ```typescript
 * const extractor = new LogfireExtractor();
 * extractor.apply(ctx);
 * ```
 */
export class LogfireExtractor implements CanonicalAttributesExtractor {
  readonly id = "logfire";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    // input: raw_input often contains chat messages already (likely JSON string)
    extractInputMessages(
      ctx,
      [{ type: "attr", keys: [ATTR_KEYS.RAW_INPUT] }],
      `${this.id}:raw_input->gen_ai.input.messages`
    );

    // output: gen_ai.choice event
    extractOutputMessages(
      ctx,
      [
        {
          type: "event",
          name: "gen_ai.choice",
          extractor: (ev: NormalizedEvent) => {
            const attrs = ev.attributes as Record<string, unknown>;
            const msg = attrs.message ?? attrs.content ?? attrs.text;
            if (msg !== undefined) {
              return { role: "assistant", content: safeJsonParse(msg) };
            }
            return undefined;
          },
        },
      ],
      `${this.id}:event(gen_ai.choice)->gen_ai.output.messages`
    );

    // type hint
    if (attrs.has(ATTR_KEYS.RAW_INPUT)) {
      inferSpanTypeIfAbsent(ctx, "llm", `${this.id}:type=llm`);
    }
  }
}
