import { describe, expect, it } from "vitest";

import { ATTR_KEYS } from "../attributeKeys.ts";
import type { CanonicalSpanContext } from "../canonicalTypes.ts";
import { canonicaliseSpanAttributes, orderedSpanCanonicalisers } from "../spanCanonicalisation.ts";

const API_SCOPE = "com.anthropic.claude-platform";
const SDK_SCOPE = "com.anthropic.sdk.python";
const SKIP = ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION;

const canonicalisers = orderedSpanCanonicalisers({
  codexScopes: { isCodexScope: () => false, execScope: "codex_exec" },
});

function canonicalise({
  name,
  scope,
  attributes,
}: {
  name: string;
  scope: string;
  attributes: Record<string, unknown>;
}): Record<string, unknown> {
  const span: CanonicalSpanContext = {
    name,
    kind: null,
    instrumentationScope: { name: scope },
    statusMessage: null,
    statusCode: null,
    parentSpanId: "0000000000000001",
  };

  return canonicaliseSpanAttributes({
    canonicalisers,
    spanAttributes: attributes,
    events: [],
    span,
  }).attributes;
}

const usage = (input: number, output: number) => ({
  "gen_ai.provider.name": "anthropic",
  "gen_ai.request.model": "claude-opus-4-7",
  "gen_ai.usage.input_tokens": input,
  "gen_ai.usage.output_tokens": output,
  "gen_ai.usage.cache_write.input_tokens": 0,
  "gen_ai.usage.cache_read.input_tokens": 0,
});

describe("AnthropicCanonicaliserService", () => {
  describe("given a Messages request with compaction", () => {
    /** @scenario "Compaction usage is counted once, on the messages.create span" */
    it("adds the compaction usage to the request and marks the compaction span", () => {
      const create = canonicalise({
        name: "anthropic.messages.create",
        scope: API_SCOPE,
        attributes: {
          ...usage(1200, 85),
          "gen_ai.operation.name": "chat",
          "anthropic.usage.compaction.input_tokens": 4000,
          "anthropic.usage.compaction.output_tokens": 300,
        },
      });
      const compaction = canonicalise({
        name: "anthropic.compaction",
        scope: API_SCOPE,
        attributes: usage(4000, 300),
      });

      expect(create[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBe(5200);
      expect(create[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(385);
      expect(create[SKIP]).toBeUndefined();
      expect(compaction[SKIP]).toBe("true");
    });
  });

  describe("given the API spans of a Messages request", () => {
    it("marks its model requests, which repeat the request's usage", () => {
      const modelRequest = canonicalise({
        name: "anthropic.model_request",
        scope: API_SCOPE,
        attributes: usage(500, 30),
      });

      expect(modelRequest[SKIP]).toBe("true");
      expect(modelRequest[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBe(500);
    });
  });

  describe("given the API spans of a Managed Agents session", () => {
    it("counts its model requests and outcome evaluations", () => {
      const modelRequest = canonicalise({
        name: "anthropic.model_request",
        scope: API_SCOPE,
        attributes: { ...usage(900, 40), "gen_ai.operation.name": "chat" },
      });
      const evaluation = canonicalise({
        name: "anthropic.session.outcome_evaluation",
        scope: API_SCOPE,
        attributes: { "gen_ai.usage.input_tokens": 300, "gen_ai.usage.output_tokens": 20 },
      });

      expect(modelRequest[SKIP]).toBeUndefined();
      expect(evaluation[SKIP]).toBeUndefined();
    });
  });

  describe("given a token count request", () => {
    it("carries no usage attribute", () => {
      const countTokens = canonicalise({
        name: "anthropic.messages.count_tokens",
        scope: SDK_SCOPE,
        attributes: {
          "gen_ai.request.model": "claude-opus-4-7",
          "anthropic.message.count_tokens.input_tokens": 1200,
        },
      });

      expect(countTokens[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBeUndefined();
      expect(countTokens[SKIP]).toBeUndefined();
    });
  });

  describe("given model-call spans from another instrumentation", () => {
    /** @scenario "Spans from other sources that nest model calls are counted as before" */
    it("marks neither the parent nor the child", () => {
      const parent = canonicalise({
        name: "anthropic.messages.create",
        scope: "openinference.instrumentation.anthropic",
        attributes: usage(1200, 85),
      });
      const child = canonicalise({
        name: "anthropic.model_request",
        scope: "opentelemetry.instrumentation.httpx",
        attributes: usage(1200, 85),
      });

      expect(parent[SKIP]).toBeUndefined();
      expect(child[SKIP]).toBeUndefined();
    });
  });

  describe("given a messages.create span whose cache writes went to the one-hour cache", () => {
    it("records the one-hour writes under their own bucket", () => {
      const create = canonicalise({
        name: "anthropic.messages.create",
        scope: SDK_SCOPE,
        attributes: {
          ...usage(2100, 50),
          "gen_ai.usage.cache_write.input_tokens": 2000,
          "anthropic.usage.cache_creation.ephemeral_5m_input_tokens": 0,
          "anthropic.usage.cache_creation.ephemeral_1h_input_tokens": 2000,
        },
      });

      expect(create[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBe(100);
      expect(create[ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS]).toBe(2000);
      expect(create[ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_1H_INPUT_TOKENS]).toBe(2000);
      expect(create[ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_5M_INPUT_TOKENS]).toBeUndefined();
    });
  });

  describe("given a tool span carrying anthropic.tool_result.content", () => {
    /** @scenario "A Claude tool span shows the tool result as its output" */
    it("reads the content as the tool-call result", () => {
      const content = [{ type: "text", text: '{"city": "Amsterdam", "temperature_c": 14}' }];
      const tool = canonicalise({
        name: "anthropic.custom_tool_use get_weather",
        scope: SDK_SCOPE,
        attributes: {
          "gen_ai.operation.name": "execute_tool",
          "gen_ai.tool.name": "get_weather",
          "gen_ai.tool.call.arguments": '{"city": "Amsterdam"}',
          "anthropic.tool_result.content": JSON.stringify(content),
        },
      });

      expect(tool[ATTR_KEYS.GEN_AI_TOOL_CALL_RESULT]).toEqual(content);
      expect(tool[ATTR_KEYS.ANTHROPIC_TOOL_RESULT_CONTENT]).toBeUndefined();
      expect(tool[ATTR_KEYS.SPAN_TYPE]).toBe("tool");
    });

    it("keeps a gen_ai.tool.call.result the emitter sent", () => {
      const tool = canonicalise({
        name: "anthropic.tool_use web_search",
        scope: API_SCOPE,
        attributes: {
          "gen_ai.tool.call.result": "sent",
          "anthropic.tool_result.content": '[{"type": "text", "text": "other"}]',
        },
      });

      expect(tool[ATTR_KEYS.GEN_AI_TOOL_CALL_RESULT]).toBe("sent");
    });
  });
});
