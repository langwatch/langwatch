import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";
import { inferSpanTypeIfAbsent } from "./_helpers";
import { ATTR_KEYS } from "./_constants";

/**
 * Fallback extractor that infers span type from various signals.
 *
 * This extractor runs last and attempts to infer the span type when no other
 * extractor has set it. It looks for:
 * - Tool call signals → "tool"
 * - Agent signals → "agent"
 * - LLM signals (GenAI, Vercel AI SDK, OpenTelemetry LLM) → "llm"
 *
 * @example
 * ```typescript
 * const extractor = new FallbackExtractor();
 * extractor.apply(ctx);
 * ```
 */
export class FallbackExtractor implements CanonicalAttributesExtractor {
  readonly id = "fallback";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    if (attrs.has(ATTR_KEYS.SPAN_TYPE)) return;

    // toolcall
    if (
      attrs.get(ATTR_KEYS.OPERATION_NAME) === "ai.toolCall" ||
      attrs.has(ATTR_KEYS.AI_TOOL_CALL_NAME)
    ) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, "tool");
      ctx.recordRule(`${this.id}:tool`);
      return;
    }

    // agent-ish
    if (
      attrs.has(ATTR_KEYS.GEN_AI_AGENT_NAME) ||
      attrs.has(ATTR_KEYS.AGENT_NAME) ||
      attrs.has(ATTR_KEYS.GEN_AI_AGENT)
    ) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, "agent");
      ctx.recordRule(`${this.id}:agent`);
      return;
    }

    // llm-ish signals
    const hasGenAi =
      attrs.has(ATTR_KEYS.GEN_AI_REQUEST_MODEL) ||
      attrs.has(ATTR_KEYS.GEN_AI_RESPONSE_MODEL) ||
      attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES) ||
      attrs.has(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES) ||
      attrs.has(ATTR_KEYS.GEN_AI_PROMPT) ||
      attrs.has(ATTR_KEYS.GEN_AI_COMPLETION) ||
      attrs.has(ATTR_KEYS.GEN_AI_OPERATION_NAME);

    const hasVercel =
      attrs.has(ATTR_KEYS.AI_PROMPT) ||
      attrs.has(ATTR_KEYS.AI_RESPONSE) ||
      attrs.has(ATTR_KEYS.AI_MODEL) ||
      attrs.has(ATTR_KEYS.AI_USAGE);
    const hasLlm =
      attrs.has(ATTR_KEYS.LLM_MODEL_NAME) ||
      attrs.has(ATTR_KEYS.LLM_INVOCATION_PARAMETERS) ||
      attrs.has(ATTR_KEYS.LLM_INPUT_MESSAGES) ||
      attrs.has(ATTR_KEYS.LLM_OUTPUT_MESSAGES);

    if (hasGenAi || hasVercel || hasLlm) {
      inferSpanTypeIfAbsent(ctx, "llm", `${this.id}:llm`);
    }
  }
}
