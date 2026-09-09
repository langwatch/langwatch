import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../ports/canonical-attributes.port.ts";
import { recordValueType } from "./canonical-extraction.rules.ts";
import { convertGeminiContent } from "./gemini-content.rules.ts";
import { asNumber, isNonEmptyString, isRecord, safeJsonParse } from "./canonical-guard.rules.ts";
import { setIfMissing, VERTEX_ADK_KEYS, VERTEX_ADK_RULE_PREFIX } from "./vertex-adk-core.rules.ts";

/** The assistant turns a response carries, under either the single-content or candidates shape. */
function responseMessages(response: Record<string, unknown>): unknown[] {
  if (isRecord(response.content)) {
    return convertGeminiContent({ content: response.content, defaultRole: "assistant" });
  }
  if (!Array.isArray(response.candidates)) return [];

  const messages: unknown[] = [];
  for (const candidate of response.candidates) {
    const candidateContent = isRecord(candidate) ? candidate.content : undefined;
    if (!isRecord(candidateContent)) continue;

    messages.push(...convertGeminiContent({ content: candidateContent, defaultRole: "assistant" }));
  }

  return messages;
}

function recordOutputMessages(ctx: ExtractorContext, response: Record<string, unknown>): void {
  const { attrs } = ctx.bag;
  if (attrs.has(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES)) return;
  if (ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES] !== void 0) return;

  const messages = responseMessages(response);
  if (messages.length === 0) return;

  ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, messages);
  ctx.recordRule(`${VERTEX_ADK_RULE_PREFIX}:llm_response->gen_ai.output.messages`);
  recordValueType(ctx, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, "chat_messages");
}

function recordUsage(ctx: ExtractorContext, response: Record<string, unknown>): void {
  const usage = isRecord(response.usage_metadata) ? response.usage_metadata : void 0;
  if (usage === void 0) return;

  const usageMap: [string, unknown][] = [
    [ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS, usage.prompt_token_count],
    [ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS, usage.candidates_token_count],
    [ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, usage.cached_content_token_count],
    [ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS, usage.thoughts_token_count],
  ];
  let hasExtractedUsage = false;
  for (const [key, raw] of usageMap) {
    const value = asNumber(raw);
    if (value !== null && setIfMissing({ ctx, key: key, value: value })) {
      hasExtractedUsage = true;
    }
  }
  if (hasExtractedUsage) {
    ctx.recordRule(`${VERTEX_ADK_RULE_PREFIX}:usage_metadata->gen_ai.usage`);
  }
}

function recordFinishReason(ctx: ExtractorContext, response: Record<string, unknown>): void {
  const recorded =
    isNonEmptyString(response.finish_reason) &&
    setIfMissing({
      ctx,
      key: ATTR_KEYS.GEN_AI_RESPONSE_FINISH_REASONS,
      value: [response.finish_reason],
    });
  if (!recorded) return;

  ctx.recordRule(`${VERTEX_ADK_RULE_PREFIX}:finish_reason`);
}

export function canonicaliseVertexAdkResponse(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;

  const response = safeJsonParse(attrs.get(VERTEX_ADK_KEYS.LLM_RESPONSE));
  if (!isRecord(response)) {
    return;
  }
  attrs.take(VERTEX_ADK_KEYS.LLM_RESPONSE);

  recordOutputMessages(ctx, response);
  recordUsage(ctx, response);
  recordFinishReason(ctx, response);
}
