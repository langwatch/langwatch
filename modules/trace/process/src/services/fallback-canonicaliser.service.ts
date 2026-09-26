/** Last-resort span-type inference and shared error consolidation. */

import { ATTR_KEYS } from "@langwatch/trace-contract";

import { extractErrorInfo, inferSpanTypeIfAbsent } from "../rules/canonical-extraction.rules.ts";
import type { AttributeCanonicaliser, ExtractorContext } from "./canonical-attributes.service.ts";

/** OTel GenAI `gen_ai.operation.name` values that are not a model call. */
const OPERATION_TO_SPAN_TYPE: Record<string, "agent" | "tool"> = {
  invoke_agent: "agent",
  create_agent: "agent",
  execute_tool: "tool",
  tool: "tool",
};

export class FallbackCanonicaliserService implements AttributeCanonicaliser {
  static create(): FallbackCanonicaliserService {
    return new FallbackCanonicaliserService();
  }

  private constructor() {}

  readonly id = "fallback";

  apply(ctx: ExtractorContext): void {
    // Skip type inference if already set (in bag or by a previous extractor)
    const isTyped =
      ctx.bag.attrs.has(ATTR_KEYS.SPAN_TYPE) || ctx.out[ATTR_KEYS.SPAN_TYPE] !== void 0;
    if (!isTyped) this.inferSpanType(ctx);
    extractErrorInfo(ctx);
  }

  private inferSpanType(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    const genAiOperation =
      ctx.out[ATTR_KEYS.GEN_AI_OPERATION_NAME] ?? attrs.get(ATTR_KEYS.GEN_AI_OPERATION_NAME);
    const operationType =
      typeof genAiOperation === "string" ? OPERATION_TO_SPAN_TYPE[genAiOperation] : void 0;
    if (operationType !== void 0) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, operationType);
      ctx.recordRule(`${this.id}:${operationType}.from_operation`);

      return;
    }

    const isToolSpan =
      attrs.get(ATTR_KEYS.OPERATION_NAME) === "ai.toolCall" ||
      attrs.has(ATTR_KEYS.AI_TOOL_CALL_NAME);
    if (isToolSpan) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, "tool");
      ctx.recordRule(`${this.id}:tool`);

      return;
    }

    const isAgentSpan =
      attrs.has(ATTR_KEYS.GEN_AI_AGENT_NAME) ||
      attrs.has(ATTR_KEYS.AGENT_NAME) ||
      attrs.has(ATTR_KEYS.GEN_AI_AGENT);
    if (isAgentSpan) {
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
  }
}
