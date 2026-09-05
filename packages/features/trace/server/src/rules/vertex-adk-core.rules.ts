import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../ports/canonical-attributes.port";
import { inferSpanTypeIfAbsent } from "./canonical-extraction.rules";
import { isNonEmptyString } from "./canonical-guard.rules";

export const VERTEX_ADK_RULE_PREFIX = "vertex-adk";
export const VERTEX_ADK_PROVIDER = "gcp.vertex.agent";

export const VERTEX_ADK_KEYS = {
  LLM_REQUEST: "gcp.vertex.agent.llm_request",
  LLM_RESPONSE: "gcp.vertex.agent.llm_response",
  TOOL_CALL_ARGS: "gcp.vertex.agent.tool_call_args",
  TOOL_RESPONSE: "gcp.vertex.agent.tool_response",
  SESSION_ID: "gcp.vertex.agent.session_id",
} as const;

const OPERATION_NAME_SPAN_TYPE_MAP: Record<string, string> = {
  generate_content: "llm",
  call_llm: "llm",
  chat: "llm",
  execute_tool: "tool",
  invoke_agent: "agent",
};

export function setIfMissing({
  ctx,
  key,
  value,
}: {
  ctx: ExtractorContext;
  key: string;
  value: unknown;
}): boolean {
  if (ctx.bag.attrs.has(key) || ctx.out[key] !== void 0) {
    return false;
  }
  ctx.setAttr(key, value);
  return true;
}

export function isVertexAdkSpan(ctx: ExtractorContext): boolean {
  const { attrs } = ctx.bag;
  const provider =
    attrs.get(ATTR_KEYS.GEN_AI_PROVIDER_NAME) ??
    attrs.get(ATTR_KEYS.GEN_AI_SYSTEM) ??
    ctx.out[ATTR_KEYS.GEN_AI_PROVIDER_NAME];

  return (
    provider === VERTEX_ADK_PROVIDER ||
    attrs.has(VERTEX_ADK_KEYS.LLM_REQUEST) ||
    attrs.has(VERTEX_ADK_KEYS.LLM_RESPONSE) ||
    attrs.has(VERTEX_ADK_KEYS.TOOL_CALL_ARGS) ||
    attrs.has(VERTEX_ADK_KEYS.TOOL_RESPONSE)
  );
}

export function canonicaliseVertexAdkCore(ctx: ExtractorContext): void {
  const operationName = ctx.bag.attrs.get(ATTR_KEYS.GEN_AI_OPERATION_NAME);
  if (isNonEmptyString(operationName)) {
    const proposedSpanType = OPERATION_NAME_SPAN_TYPE_MAP[operationName];
    if (proposedSpanType) {
      inferSpanTypeIfAbsent(
        ctx,
        proposedSpanType,
        `${VERTEX_ADK_RULE_PREFIX}:gen_ai.operation.name->langwatch.span.type`,
      );
    }
  }

  const sessionId = ctx.bag.attrs.get(VERTEX_ADK_KEYS.SESSION_ID);
  if (
    isNonEmptyString(sessionId) &&
    setIfMissing({
      ctx,
      key: ATTR_KEYS.GEN_AI_CONVERSATION_ID,
      value: sessionId,
    })
  ) {
    ctx.recordRule(`${VERTEX_ADK_RULE_PREFIX}:session_id->gen_ai.conversation.id`);
  }
}
