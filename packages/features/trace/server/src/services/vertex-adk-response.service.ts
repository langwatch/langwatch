import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../ports/canonical-attributes.port";
import { recordValueType } from "./canonical-extraction.service";
import { convertGeminiContent } from "./gemini-content.service";
import {
  asNumber,
  isNonEmptyString,
  isRecord,
  safeJsonParse,
} from "./canonical-guard.service";
import {
  setIfMissing,
  VERTEX_ADK_KEYS,
  VERTEX_ADK_RULE_PREFIX,
} from "./vertex-adk-core.service";

export function canonicaliseVertexAdkResponse(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;

  const response = safeJsonParse(attrs.get(VERTEX_ADK_KEYS.LLM_RESPONSE));
  if (!isRecord(response)) {
    return;
  }
  attrs.take(VERTEX_ADK_KEYS.LLM_RESPONSE);

  if (
    !attrs.has(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES) &&
    ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES] === void 0
  ) {
    const messages: unknown[] = [];
    if (isRecord(response.content)) {
      messages.push(
        ...convertGeminiContent({
          content: response.content,
          defaultRole: "assistant",
        }),
      );
    } else if (Array.isArray(response.candidates)) {
      for (const candidate of response.candidates) {
        if (isRecord(candidate) && isRecord(candidate.content)) {
          messages.push(
            ...convertGeminiContent({
              content: candidate.content,
              defaultRole: "assistant",
            }),
          );
        }
      }
    }
    if (messages.length > 0) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, messages);
      ctx.recordRule(`${VERTEX_ADK_RULE_PREFIX}:llm_response->gen_ai.output.messages`);
      recordValueType(ctx, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, "chat_messages");
    }
  }

  const usage = isRecord(response.usage_metadata) ? response.usage_metadata : void 0;
  if (usage !== void 0) {
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

  if (isNonEmptyString(response.finish_reason)) {
    if (
      setIfMissing({
        ctx,
        key: ATTR_KEYS.GEN_AI_RESPONSE_FINISH_REASONS,
        value: [response.finish_reason],
      })
    ) {
      ctx.recordRule(`${VERTEX_ADK_RULE_PREFIX}:finish_reason`);
    }
  }
}
