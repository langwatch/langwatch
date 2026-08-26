import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../ports/canonical-attributes.port";
import { recordValueType } from "./canonical-extraction.service";
import { convertGeminiContent, systemInstructionText } from "./gemini-content.service";
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

export function canonicaliseVertexAdkRequest(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;

  const request = safeJsonParse(attrs.get(VERTEX_ADK_KEYS.LLM_REQUEST));
  if (!isRecord(request)) {
    return;
  }
  attrs.take(VERTEX_ADK_KEYS.LLM_REQUEST);

  if (
    isNonEmptyString(request.model) &&
    setIfMissing({
      ctx,
      key: ATTR_KEYS.GEN_AI_REQUEST_MODEL,
      value: request.model,
    })
  ) {
    ctx.recordRule(`${VERTEX_ADK_RULE_PREFIX}:llm_request.model->gen_ai.request.model`);
  }

  if (
    !attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES) &&
    ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES] === void 0 &&
    Array.isArray(request.contents)
  ) {
    const messages = request.contents.flatMap((content) =>
      convertGeminiContent({ content, defaultRole: "user" }),
    );
    if (messages.length > 0) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, messages);
      ctx.recordRule(`${VERTEX_ADK_RULE_PREFIX}:llm_request->gen_ai.input.messages`);
      recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");
    }
  }

  const config = isRecord(request.config) ? request.config : void 0;
  if (config === void 0) {
    return;
  }

  const sysInstruction = systemInstructionText(config.system_instruction);
  if (
    sysInstruction !== null &&
    setIfMissing({
      ctx,
      key: ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS,
      value: sysInstruction,
    })
  ) {
    ctx.recordRule(`${VERTEX_ADK_RULE_PREFIX}:system_instruction`);
  }

  if (Array.isArray(config.tools) && config.tools.length > 0) {
    if (
      setIfMissing({
        ctx,
        key: ATTR_KEYS.GEN_AI_TOOL_DEFINITIONS,
        value: config.tools,
      })
    ) {
      ctx.recordRule(`${VERTEX_ADK_RULE_PREFIX}:tools->gen_ai.tool.definitions`);
    }
  }

  const paramMap: [string, unknown][] = [
    [ATTR_KEYS.GEN_AI_REQUEST_TEMPERATURE, config.temperature],
    [ATTR_KEYS.GEN_AI_REQUEST_TOP_P, config.top_p],
    [ATTR_KEYS.GEN_AI_REQUEST_TOP_K, config.top_k],
    [ATTR_KEYS.GEN_AI_REQUEST_MAX_TOKENS, config.max_output_tokens],
  ];
  let hasExtractedParams = false;
  for (const [key, raw] of paramMap) {
    const value = asNumber(raw);
    if (value !== null && setIfMissing({ ctx, key: key, value: value })) {
      hasExtractedParams = true;
    }
  }
  if (hasExtractedParams) {
    ctx.recordRule(`${VERTEX_ADK_RULE_PREFIX}:params`);
  }
}
