/** Maps Logfire raw input and choice events to canonical GenAI attributes. */

import { ATTR_KEYS } from "./attributeKeys.ts";
import type { AttributeCanonicaliser, ExtractorContext } from "./canonicalAttributes.ts";
import {
  extractInputMessages,
  extractOutputMessages,
  inferSpanTypeIfAbsent,
  recordValueType,
} from "./canonicalExtraction.ts";
import { parseJsonSafely } from "./canonicalGuard.ts";
import type { CanonicalEvent } from "./canonicalTypes.ts";

export class LogfireCanonicaliserService implements AttributeCanonicaliser {
  static create(): LogfireCanonicaliserService {
    return new LogfireCanonicaliserService();
  }

  private constructor() {}

  readonly id = "logfire";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    if (
      extractInputMessages(
        ctx,
        [{ type: "attr", keys: [ATTR_KEYS.RAW_INPUT] }],
        `${this.id}:raw_input->gen_ai.input.messages`,
      )
    ) {
      recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");
    }

    const extractedOutputMessages = extractOutputMessages(
      ctx,
      [
        {
          type: "event",
          name: "gen_ai.choice",
          extractor: (event: CanonicalEvent) => {
            const eventAttrs = event.attributes;
            const message = eventAttrs.message ?? eventAttrs.content ?? eventAttrs.text;

            if (message !== void 0) {
              return { role: "assistant", content: parseJsonSafely(message) };
            }

            return void 0;
          },
        },
      ],
      `${this.id}:event(gen_ai.choice)->gen_ai.output.messages`,
    );
    if (extractedOutputMessages) {
      recordValueType(ctx, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, "chat_messages");
    }

    if (attrs.has(ATTR_KEYS.RAW_INPUT)) {
      inferSpanTypeIfAbsent(ctx, "llm", `${this.id}:type=llm`);
    }
  }
}
