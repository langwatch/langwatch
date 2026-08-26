/** Last-resort span-type inference and shared error consolidation. */

import { ATTR_KEYS } from "@langwatch/trace-contract";
import {
  extractErrorInfo,
  inferSpanTypeIfAbsent,
} from "../services/canonical-extraction.service";
import type {
  CanonicalAttributesPort,
  ExtractorContext,
} from "../ports/canonical-attributes.port";

export class FallbackCanonicalisationAdapter implements CanonicalAttributesPort {
  readonly id = "fallback";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    // Skip type inference if already set (in bag or by a previous extractor)
    if (attrs.has(ATTR_KEYS.SPAN_TYPE) || ctx.out[ATTR_KEYS.SPAN_TYPE] !== void 0) {
      extractErrorInfo(ctx);
      return;
    }

    if (
      attrs.get(ATTR_KEYS.OPERATION_NAME) === "ai.toolCall" ||
      attrs.has(ATTR_KEYS.AI_TOOL_CALL_NAME) ||
      attrs.get(ATTR_KEYS.GEN_AI_OPERATION_NAME) === "tool"
    ) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, "tool");
      ctx.recordRule(`${this.id}:tool`);
      return;
    }

    if (
      attrs.has(ATTR_KEYS.GEN_AI_AGENT_NAME) ||
      attrs.has(ATTR_KEYS.AGENT_NAME) ||
      attrs.has(ATTR_KEYS.GEN_AI_AGENT)
    ) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, "agent");
      ctx.recordRule(`${this.id}:agent`);
      return;
    }

    const hasGenAiSignals =
      attrs.has(ATTR_KEYS.GEN_AI_REQUEST_MODEL) ||
      attrs.has(ATTR_KEYS.GEN_AI_RESPONSE_MODEL) ||
      attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES) ||
      attrs.has(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES) ||
      attrs.has(ATTR_KEYS.GEN_AI_PROMPT) ||
      attrs.has(ATTR_KEYS.GEN_AI_COMPLETION) ||
      attrs.has(ATTR_KEYS.GEN_AI_OPERATION_NAME);

    const hasVercelSignals =
      attrs.has(ATTR_KEYS.AI_PROMPT) ||
      attrs.has(ATTR_KEYS.AI_RESPONSE) ||
      attrs.has(ATTR_KEYS.AI_MODEL) ||
      attrs.has(ATTR_KEYS.AI_USAGE);

    const hasLegacyLlmSignals =
      attrs.has(ATTR_KEYS.LLM_MODEL_NAME) ||
      attrs.has(ATTR_KEYS.LLM_INVOCATION_PARAMETERS) ||
      attrs.has(ATTR_KEYS.LLM_INPUT_MESSAGES) ||
      attrs.has(ATTR_KEYS.LLM_OUTPUT_MESSAGES);

    if (hasGenAiSignals || hasVercelSignals || hasLegacyLlmSignals) {
      inferSpanTypeIfAbsent(ctx, "llm", `${this.id}:llm`);
    }

    extractErrorInfo(ctx);
  }
}
