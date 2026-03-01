/**
 * Fallback Extractor
 *
 * Handles: Span type inference when no other extractor has set it
 *
 * This extractor runs last (by registration order) and attempts to infer
 * the span type from available signals when no explicit type has been set.
 *
 * Detection: Absence of langwatch.span.type after all other extractors
 *
 * Canonical attributes produced:
 * - langwatch.span.type (inferred from available signals)
 *
 * Inference priority:
 * 1. Tool call indicators → tool
 * 2. Agent indicators → agent
 * 3. LLM/GenAI indicators → llm
 */

import { ATTR_KEYS } from "./_constants";
import { extractErrorInfo, inferSpanTypeIfAbsent } from "./_extraction";
import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";

export class FallbackExtractor implements CanonicalAttributesExtractor {
  readonly id = "fallback";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    // Skip if type is already set
    if (attrs.has(ATTR_KEYS.SPAN_TYPE)) {
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tool Call Detection
    // Check for tool call indicators (Vercel AI SDK, OTEL GenAI spec)
    // ─────────────────────────────────────────────────────────────────────────
    if (
      attrs.get(ATTR_KEYS.OPERATION_NAME) === "ai.toolCall" ||
      attrs.has(ATTR_KEYS.AI_TOOL_CALL_NAME) ||
      attrs.get(ATTR_KEYS.GEN_AI_OPERATION_NAME) === "tool"
    ) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, "tool");
      ctx.recordRule(`${this.id}:tool`);
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Agent Detection
    // Check for agent-related attributes
    // ─────────────────────────────────────────────────────────────────────────
    if (
      attrs.has(ATTR_KEYS.GEN_AI_AGENT_NAME) ||
      attrs.has(ATTR_KEYS.AGENT_NAME) ||
      attrs.has(ATTR_KEYS.GEN_AI_AGENT)
    ) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, "agent");
      ctx.recordRule(`${this.id}:agent`);
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LLM Detection
    // Check for various LLM-related signals
    // ─────────────────────────────────────────────────────────────────────────

    // Modern GenAI semantic conventions
    const hasGenAiSignals =
      attrs.has(ATTR_KEYS.GEN_AI_REQUEST_MODEL) ||
      attrs.has(ATTR_KEYS.GEN_AI_RESPONSE_MODEL) ||
      attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES) ||
      attrs.has(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES) ||
      attrs.has(ATTR_KEYS.GEN_AI_PROMPT) ||
      attrs.has(ATTR_KEYS.GEN_AI_COMPLETION) ||
      attrs.has(ATTR_KEYS.GEN_AI_OPERATION_NAME);

    // Vercel AI SDK signals
    const hasVercelSignals =
      attrs.has(ATTR_KEYS.AI_PROMPT) ||
      attrs.has(ATTR_KEYS.AI_RESPONSE) ||
      attrs.has(ATTR_KEYS.AI_MODEL) ||
      attrs.has(ATTR_KEYS.AI_USAGE);

    // Legacy LLM namespace signals
    const hasLegacyLlmSignals =
      attrs.has(ATTR_KEYS.LLM_MODEL_NAME) ||
      attrs.has(ATTR_KEYS.LLM_INVOCATION_PARAMETERS) ||
      attrs.has(ATTR_KEYS.LLM_INPUT_MESSAGES) ||
      attrs.has(ATTR_KEYS.LLM_OUTPUT_MESSAGES);

    if (hasGenAiSignals || hasVercelSignals || hasLegacyLlmSignals) {
      inferSpanTypeIfAbsent(ctx, "llm", `${this.id}:llm`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Error Consolidation
    // Runs for every span regardless of SDK. Consolidates exception.*,
    // error.*, status.message, span.error.* into canonical error.type.
    // ─────────────────────────────────────────────────────────────────────────
    extractErrorInfo(ctx);
  }
}
