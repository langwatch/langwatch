/** Maps Logfire raw input and choice events to canonical GenAI attributes. */

import type { CanonicalEvent } from "@langwatch/trace-contract";
import { ATTR_KEYS } from "@langwatch/trace-contract";
import {
  extractInputMessages,
  extractOutputMessages,
  inferSpanTypeIfAbsent,
  recordValueType,
} from "../services/canonical-extraction.service";
import { safeJsonParse } from "../services/canonical-guard.service";
import type {
  CanonicalAttributesPort,
  ExtractorContext,
} from "../ports/canonical-attributes.port";

export class LogfireCanonicalisationAdapter implements CanonicalAttributesPort {
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

    if (
      extractOutputMessages(
        ctx,
        [
          {
            type: "event",
            name: "gen_ai.choice",
            extractor: (event: CanonicalEvent) => {
              const eventAttrs = event.attributes;
              const message = eventAttrs.message ?? eventAttrs.content ?? eventAttrs.text;

              if (message !== void 0) {
                return { role: "assistant", content: safeJsonParse(message) };
              }
              return void 0;
            },
          },
        ],
        `${this.id}:event(gen_ai.choice)->gen_ai.output.messages`,
      )
    ) {
      recordValueType(ctx, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, "chat_messages");
    }

    if (attrs.has(ATTR_KEYS.RAW_INPUT)) {
      inferSpanTypeIfAbsent(ctx, "llm", `${this.id}:type=llm`);
    }
  }
}
