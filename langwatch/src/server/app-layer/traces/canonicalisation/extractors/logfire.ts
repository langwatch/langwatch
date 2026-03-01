/**
 * Logfire Extractor
 *
 * Handles: Pydantic Logfire SDK telemetry
 * Reference: https://logfire.pydantic.dev/
 *
 * Logfire uses raw_input for chat messages and gen_ai.choice events for output.
 * This extractor maps those to canonical gen_ai.* attributes.
 *
 * Detection: Presence of raw_input attribute
 *
 * Canonical attributes produced:
 * - langwatch.span.type (llm inference)
 * - gen_ai.input.messages (from raw_input)
 * - gen_ai.output.messages (from gen_ai.choice events)
 */

import type { NormalizedEvent } from "../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { ATTR_KEYS } from "./_constants";
import {
  extractInputMessages,
  extractOutputMessages,
  inferSpanTypeIfAbsent,
  recordValueType,
} from "./_extraction";
import { safeJsonParse } from "./_guards";
import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";

export class LogfireExtractor implements CanonicalAttributesExtractor {
  readonly id = "logfire";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    // ─────────────────────────────────────────────────────────────────────────
    // Input Messages (from raw_input)
    // raw_input often contains chat messages (typically JSON string)
    // ─────────────────────────────────────────────────────────────────────────
    if (extractInputMessages(
      ctx,
      [{ type: "attr", keys: [ATTR_KEYS.RAW_INPUT] }],
      `${this.id}:raw_input->gen_ai.input.messages`,
    )) {
      recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Output Messages (from gen_ai.choice events)
    // Logfire uses gen_ai.choice events with message/content/text attributes
    // ─────────────────────────────────────────────────────────────────────────
    if (extractOutputMessages(
      ctx,
      [
        {
          type: "event",
          name: "gen_ai.choice",
          extractor: (event: NormalizedEvent) => {
            const eventAttrs = event.attributes as Record<string, unknown>;
            const message =
              eventAttrs.message ?? eventAttrs.content ?? eventAttrs.text;

            if (message !== undefined) {
              return { role: "assistant", content: safeJsonParse(message) };
            }
            return undefined;
          },
        },
      ],
      `${this.id}:event(gen_ai.choice)->gen_ai.output.messages`,
    )) {
      recordValueType(ctx, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, "chat_messages");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Span Type Inference
    // If raw_input is present, this is likely an LLM span
    // ─────────────────────────────────────────────────────────────────────────
    if (attrs.has(ATTR_KEYS.RAW_INPUT)) {
      inferSpanTypeIfAbsent(ctx, "llm", `${this.id}:type=llm`);
    }
  }
}
