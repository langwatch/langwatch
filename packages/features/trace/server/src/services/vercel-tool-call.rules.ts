import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../ports/canonical-attributes.port";
import { isNonEmptyString } from "./canonical-guard.rules";

const VERCEL_RULE_PREFIX = "vercel";

export const AI_SDK_SPAN_TYPE_MAP: Record<string, string> = {
  // Text generation spans
  "ai.generateText": "llm",
  "ai.streamText": "llm",
  "ai.generateObject": "llm",
  "ai.streamObject": "llm",

  // Provider-level spans
  "ai.generateText.doGenerate": "llm",
  "ai.streamText.doStream": "llm",
  "ai.generateObject.doGenerate": "llm",
  "ai.streamObject.doStream": "llm",

  // Tool execution spans
  "ai.toolCall": "tool",

  // Embedding spans
  "ai.embed": "component",
  "ai.embedMany": "component",
  "ai.embed.doEmbed": "component",
  "ai.embedMany.doEmbed": "component",
} as const;

export function canonicaliseVercelToolCall(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;
  const toolName = attrs.take(ATTR_KEYS.AI_TOOL_CALL_NAME);
  if (isNonEmptyString(toolName)) {
    ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_TOOL_NAME, toolName);
    ctx.recordRule(`${VERCEL_RULE_PREFIX}:ai.toolCall.name->gen_ai.tool.name`);
  }

  const args = stringifyToolPayload(attrs.take(ATTR_KEYS.AI_TOOL_CALL_ARGS));
  if (args !== null) {
    ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_INPUT, args);
    ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_TOOL_CALL_ARGUMENTS, args);
    ctx.recordRule(`${VERCEL_RULE_PREFIX}:ai.toolCall.args->input`);
  }

  const result = stringifyToolPayload(attrs.take(ATTR_KEYS.AI_TOOL_CALL_RESULT));
  if (result !== null) {
    ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_OUTPUT, result);
    ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_TOOL_CALL_RESULT, result);
    ctx.recordRule(`${VERCEL_RULE_PREFIX}:ai.toolCall.result->output`);
  }
}

export function stringifyToolPayload(raw: unknown): string | null {
  if (raw === void 0 || raw === null) {
    return null;
  }
  if (typeof raw === "string") {
    return raw.length > 0 ? raw : null;
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
}
