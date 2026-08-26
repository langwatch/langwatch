import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../ports/canonical-attributes.port";
import { stringifyToolPayload } from "./gemini-content.service";
import {
  setIfMissing,
  VERTEX_ADK_KEYS,
  VERTEX_ADK_RULE_PREFIX,
} from "./vertex-adk-core.service";

export function canonicaliseVertexAdkToolCall(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;

  const args = stringifyToolPayload(attrs.get(VERTEX_ADK_KEYS.TOOL_CALL_ARGS));
  if (args !== null) {
    attrs.take(VERTEX_ADK_KEYS.TOOL_CALL_ARGS);
    const hasSetArgs = [
      setIfMissing({ ctx, key: ATTR_KEYS.LANGWATCH_INPUT, value: args }),
      setIfMissing({
        ctx,
        key: ATTR_KEYS.GEN_AI_TOOL_CALL_ARGUMENTS,
        value: args,
      }),
    ].some(Boolean);
    if (hasSetArgs) {
      ctx.recordRule(`${VERTEX_ADK_RULE_PREFIX}:tool_call_args->input`);
    }
  }

  const result = stringifyToolPayload(attrs.get(VERTEX_ADK_KEYS.TOOL_RESPONSE));
  if (result !== null) {
    attrs.take(VERTEX_ADK_KEYS.TOOL_RESPONSE);
    const hasSetResult = [
      setIfMissing({
        ctx,
        key: ATTR_KEYS.LANGWATCH_OUTPUT,
        value: result,
      }),
      setIfMissing({
        ctx,
        key: ATTR_KEYS.GEN_AI_TOOL_CALL_RESULT,
        value: result,
      }),
    ].some(Boolean);
    if (hasSetResult) {
      ctx.recordRule(`${VERTEX_ADK_RULE_PREFIX}:tool_response->output`);
    }
  }
}
