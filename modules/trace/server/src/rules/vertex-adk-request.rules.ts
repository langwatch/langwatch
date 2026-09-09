import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../ports/canonical-attributes.port.ts";
import { recordValueType } from "./canonical-extraction.rules.ts";
import { convertGeminiContent, systemInstructionText } from "./gemini-content.rules.ts";
import { asNumber, isNonEmptyString, isRecord, safeJsonParse } from "./canonical-guard.rules.ts";
import { setIfMissing, VERTEX_ADK_KEYS, VERTEX_ADK_RULE_PREFIX } from "./vertex-adk-core.rules.ts";

/** The request's `contents` become the canonical input messages, when nothing set them first. */
function recordInputMessages(ctx: ExtractorContext, contents: unknown): void {
  const { attrs } = ctx.bag;
  if (attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES)) return;
  if (ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES] !== void 0) return;
  if (!Array.isArray(contents)) return;

  const messages = contents.flatMap((content) =>
    convertGeminiContent({ content, defaultRole: "user" }),
  );
  if (messages.length === 0) return;

  ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, messages);
  ctx.recordRule(`${VERTEX_ADK_RULE_PREFIX}:llm_request->gen_ai.input.messages`);
  recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");
}

function recordSystemInstruction(ctx: ExtractorContext, config: Record<string, unknown>): void {
  const sysInstruction = systemInstructionText(config.system_instruction);
  if (sysInstruction === null) return;
  if (!setIfMissing({ ctx, key: ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS, value: sysInstruction })) {
    return;
  }

  ctx.recordRule(`${VERTEX_ADK_RULE_PREFIX}:system_instruction`);
}

function recordToolDefinitions(ctx: ExtractorContext, config: Record<string, unknown>): void {
  const recorded =
    Array.isArray(config.tools) &&
    config.tools.length > 0 &&
    setIfMissing({ ctx, key: ATTR_KEYS.GEN_AI_TOOL_DEFINITIONS, value: config.tools });
  if (!recorded) return;

  ctx.recordRule(`${VERTEX_ADK_RULE_PREFIX}:tools->gen_ai.tool.definitions`);
}

function recordSamplingParams(ctx: ExtractorContext, config: Record<string, unknown>): void {
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

function recordRequestModel(ctx: ExtractorContext, request: Record<string, unknown>): void {
  const recorded =
    isNonEmptyString(request.model) &&
    setIfMissing({ ctx, key: ATTR_KEYS.GEN_AI_REQUEST_MODEL, value: request.model });
  if (!recorded) return;

  ctx.recordRule(`${VERTEX_ADK_RULE_PREFIX}:llm_request.model->gen_ai.request.model`);
}

export function canonicaliseVertexAdkRequest(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;

  const request = safeJsonParse(attrs.get(VERTEX_ADK_KEYS.LLM_REQUEST));
  if (!isRecord(request)) {
    return;
  }
  attrs.take(VERTEX_ADK_KEYS.LLM_REQUEST);

  recordRequestModel(ctx, request);
  recordInputMessages(ctx, request.contents);

  const config = isRecord(request.config) ? request.config : void 0;
  if (config === void 0) {
    return;
  }

  recordSystemInstruction(ctx, config);
  recordToolDefinitions(ctx, config);
  recordSamplingParams(ctx, config);
}
