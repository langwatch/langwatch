import { describe, expect, it } from "vitest";

import { ATTR_KEYS, CLAUDE_CODE_LLM_REQUEST_SPAN_NAME } from "../attributeKeys.ts";
import type { CanonicalAttributes } from "../canonicalTypes.ts";
import { canonicaliseSpanAttributes, orderedSpanCanonicalisers } from "../spanCanonicalisation.ts";

const codexScopes = { isCodexScope: () => false, execScope: "codex_exec" };

const INPUT = ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS;
const OUTPUT = ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS;
const TOTAL = ATTR_KEYS.GEN_AI_USAGE_TOTAL_TOKENS;
const CACHE_READ = ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS;
const CACHE_CREATION = ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS;

/** Every canonicaliser over one span, as ingestion runs them. */
function canonicalise({
  attributes,
  scope,
  name = "chat",
}: {
  attributes: CanonicalAttributes;
  scope: string;
  name?: string;
}): CanonicalAttributes {
  return canonicaliseSpanAttributes({
    canonicalisers: orderedSpanCanonicalisers({ codexScopes }),
    spanAttributes: attributes,
    events: [],
    span: {
      name,
      kind: null,
      instrumentationScope: { name: scope },
      statusMessage: null,
      statusCode: null,
      parentSpanId: null,
    },
  }).attributes;
}

describe("FreshInputCanonicaliserService", () => {
  describe("when the source counts the cache inside its input, as the GenAI conventions do", () => {
    /** @scenario "Instrumentations that follow the GenAI conventions have their input restated as fresh input" */
    it.each([
      {
        source: "OpenLLMetry with Anthropic",
        scope: "opentelemetry.instrumentation.anthropic",
        attributes: {
          [ATTR_KEYS.GEN_AI_SYSTEM]: "anthropic",
          [INPUT]: 15_232,
          [CACHE_READ]: 15_217,
        },
        fresh: 15,
      },
      {
        source: "OpenLLMetry with OpenAI",
        scope: "opentelemetry.instrumentation.openai.v1",
        attributes: { [ATTR_KEYS.GEN_AI_SYSTEM]: "openai", [INPUT]: 1_200, [CACHE_READ]: 1_024 },
        fresh: 176,
      },
      {
        source: "Pydantic AI",
        scope: "pydantic-ai",
        attributes: { [INPUT]: 15_232, [CACHE_READ]: 15_217, [CACHE_CREATION]: 0 },
        fresh: 15,
      },
      {
        source: "LiteLLM",
        scope: "litellm",
        attributes: { [INPUT]: 30_449, [CACHE_READ]: 15_217, [CACHE_CREATION]: 15_217 },
        fresh: 15,
      },
      {
        source: "Copilot",
        scope: "@github/copilot",
        attributes: {
          [ATTR_KEYS.GEN_AI_OPERATION_NAME]: "chat",
          [INPUT]: 15_560,
          [CACHE_READ]: 12_000,
        },
        fresh: 3_560,
      },
      {
        source: "Mastra",
        scope: "@mastra/otel",
        attributes: { [ATTR_KEYS.GEN_AI_SYSTEM]: "anthropic", [INPUT]: 9_000, [CACHE_READ]: 8_745 },
        fresh: 255,
      },
    ])("restates $source's input count as the fresh remainder", ({ scope, attributes, fresh }) => {
      const result = canonicalise({ attributes: { ...attributes, [OUTPUT]: 22 }, scope });

      expect(result[INPUT]).toBe(fresh);
      expect(result[CACHE_READ]).toBe(attributes[CACHE_READ]);
    });

    /** @scenario "Older OpenLLMetry and Strands cache keys are read as cache reads and writes" */
    it.each([
      {
        key: "gen_ai.usage.cache_creation_input_tokens",
        scope: "opentelemetry.instrumentation.anthropic",
      },
      { key: "gen_ai.usage.cache_write_input_tokens", scope: "strands.telemetry.tracer" },
    ])("reads the underscore cache keys with $key and restates the input", ({ key, scope }) => {
      const result = canonicalise({
        attributes: {
          [ATTR_KEYS.GEN_AI_USAGE_PROMPT_TOKENS]: 1_300,
          [OUTPUT]: 20,
          "gen_ai.usage.cache_read_input_tokens": 1_000,
          [key]: 200,
        },
        scope,
      });

      expect(result[CACHE_READ]).toBe(1_000);
      expect(result[CACHE_CREATION]).toBe(200);
      expect(result[INPUT]).toBe(100);
      expect(result["gen_ai.usage.cache_read_input_tokens"]).toBeUndefined();
    });

    /** @scenario "An OpenInference prompt count that includes its cache is restated as fresh input" */
    it("restates an OpenInference prompt count as the fresh remainder", () => {
      const result = canonicalise({
        attributes: {
          [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT]: 2_000,
          [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_COMPLETION]: 40,
          [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_READ]: 1_500,
          [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_WRITE]: 300,
        },
        scope: "openinference.instrumentation.anthropic",
      });

      expect(result[INPUT]).toBe(200);
      expect(result[CACHE_READ]).toBe(1_500);
      expect(result[CACHE_CREATION]).toBe(300);
    });

    /** @scenario "A Strands span whose total counts the cache inside its input is restated as fresh input" */
    it("restates a current Strands input, whose total is input plus output", () => {
      const result = canonicalise({
        attributes: {
          [INPUT]: 1_300,
          [OUTPUT]: 20,
          [TOTAL]: 1_320,
          [CACHE_READ]: 1_000,
          [CACHE_CREATION]: 200,
        },
        scope: "strands.telemetry.tracer",
      });

      expect(result[INPUT]).toBe(100);
    });
  });

  describe("when the source already sends the fresh input", () => {
    /** @scenario "A span whose stated total counts its input as fresh keeps its input" */
    it.each([
      {
        source: "the LangWatch gateway",
        scope: "langwatch-ai-gateway",
        attributes: { [INPUT]: 176, [OUTPUT]: 50, [TOTAL]: 1_250, [CACHE_READ]: 1_024 },
      },
      {
        source: "an older Strands release",
        scope: "strands.telemetry.tracer",
        attributes: {
          [INPUT]: 100,
          [OUTPUT]: 20,
          [TOTAL]: 1_320,
          [CACHE_READ]: 1_000,
          [CACHE_CREATION]: 200,
        },
      },
    ])("keeps $source's input", ({ scope, attributes }) => {
      const result = canonicalise({ attributes, scope });

      expect(result[INPUT]).toBe(attributes[INPUT]);
    });

    /** @scenario "A LangWatch SDK span with the flat cached input count keeps its fresh input" */
    it("keeps the input a LangWatch SDK sends beside the flat cached input count", () => {
      const result = canonicalise({
        attributes: {
          [INPUT]: 100,
          [OUTPUT]: 20,
          [ATTR_KEYS.GEN_AI_USAGE_CACHED_INPUT_TOKENS]: 1_000,
          [CACHE_CREATION]: 200,
        },
        scope: "github.com/langwatch/langwatch/sdks/go/instrumentation/anthropic",
      });

      expect(result[INPUT]).toBe(100);
      expect(result[CACHE_READ]).toBe(1_000);
      expect(result[ATTR_KEYS.GEN_AI_USAGE_CACHED_INPUT_TOKENS]).toBeUndefined();
    });

    /** @scenario "A LangWatch REST collector span keeps its fresh input" */
    it("keeps the input of a span the REST collector built from SDK metrics", () => {
      const result = canonicalise({
        attributes: { [INPUT]: 100, [OUTPUT]: 20, [CACHE_READ]: 1_000 },
        scope: "langwatch.rest.collector",
      });

      expect(result[INPUT]).toBe(100);
    });

    /** @scenario "A Claude Code span keeps its fresh input" */
    it("keeps the input of a Claude Code llm_request span", () => {
      const result = canonicalise({
        attributes: {
          input_tokens: 15,
          output_tokens: 22,
          cache_read_tokens: 15_217,
          cache_creation_tokens: 15_217,
        },
        scope: "com.anthropic.claude_code",
        name: CLAUDE_CODE_LLM_REQUEST_SPAN_NAME,
      });

      expect(result[INPUT]).toBe(15);
      expect(result[CACHE_READ]).toBe(15_217);
    });

    /** @scenario "A Spring AI Anthropic span keeps its input as sent and a Spring AI OpenAI span is restated" */
    it("keeps a Spring AI Anthropic input and restates a Spring AI OpenAI one", () => {
      const anthropic = canonicalise({
        attributes: {
          "spring.ai.kind": "chat_model",
          [ATTR_KEYS.GEN_AI_SYSTEM]: "anthropic",
          [INPUT]: 15,
          [OUTPUT]: 22,
          [CACHE_READ]: 15_217,
        },
        scope: "org.springframework.boot",
      });
      const openai = canonicalise({
        attributes: {
          "spring.ai.kind": "chat_model",
          [ATTR_KEYS.GEN_AI_SYSTEM]: "openai",
          [INPUT]: 1_200,
          [OUTPUT]: 22,
          [CACHE_READ]: 1_024,
        },
        scope: "org.springframework.boot",
      });

      expect(anthropic[INPUT]).toBe(15);
      expect(openai[INPUT]).toBe(176);
    });

    /** @scenario "An older Mastra Anthropic span keeps its input as sent and an older Mastra OpenAI span is restated" */
    it("keeps an older Mastra Anthropic input and restates an older Mastra OpenAI one", () => {
      const older = (provider: string, input: number) =>
        canonicalise({
          attributes: {
            [ATTR_KEYS.GEN_AI_SYSTEM]: provider,
            [INPUT]: input,
            [OUTPUT]: 22,
            [ATTR_KEYS.GEN_AI_USAGE_CACHED_INPUT_TOKENS]: 8_745,
          },
          scope: "@mastra/otel",
        });

      const anthropic = older("anthropic", 255);
      const openai = older("openai", 9_000);

      expect(anthropic[INPUT]).toBe(255);
      expect(anthropic[CACHE_READ]).toBe(8_745);
      expect(openai[INPUT]).toBe(255);
      expect(openai[CACHE_READ]).toBe(8_745);
    });
  });

  /** @scenario "An input count is restated once, whichever passes see its cache" */
  it("takes a Claude SDK span's cache out of its input once", () => {
    const result = canonicalise({
      attributes: {
        [ATTR_KEYS.GEN_AI_SYSTEM]: "anthropic",
        [INPUT]: 1_100,
        [OUTPUT]: 22,
        [CACHE_READ]: 100,
        [ATTR_KEYS.GEN_AI_USAGE_CACHE_WRITE_INPUT_TOKENS]: 0,
      },
      scope: "anthropic",
      name: "anthropic.messages.create",
    });

    expect(result[INPUT]).toBe(1_000);
  });

  /** @scenario "A span without cache buckets keeps its input" */
  it("keeps the input of a span without cache reads or writes", () => {
    const result = canonicalise({
      attributes: { [INPUT]: 500, [OUTPUT]: 22 },
      scope: "opentelemetry.instrumentation.openai.v1",
    });

    expect(result[INPUT]).toBe(500);
  });
});
