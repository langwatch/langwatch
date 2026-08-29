import { describe, expect, it } from "vitest";
import { canonicalisation, makeStubSpan } from "./test-helpers";
import { ATTR_KEYS } from "@langwatch/trace-contract";

const stubSpan = makeStubSpan();

describe("TraceCanonicalisationService — langwatch.metrics handling", () => {
  describe("when the TypeScript SDK sends the structured metrics shape", () => {
    it("extracts token counts and cost from { type, value }", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.metrics": JSON.stringify({
            type: "json",
            value: { promptTokens: 10, completionTokens: 5, cost: 0.001 },
          }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["gen_ai.usage.input_tokens"]).toBe(10);
      expect(result.attributes["gen_ai.usage.output_tokens"]).toBe(5);
      expect(result.attributes["langwatch.span.cost"]).toBe(0.001);
    });

    it("extracts the tokensEstimated flag", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.metrics": JSON.stringify({
            type: "json",
            value: { promptTokens: 10, tokensEstimated: true },
          }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["langwatch.tokens.estimated"]).toBe(true);
    });
  });

  describe("when the Python SDK sends the bare snake_case metrics shape", () => {
    it("extracts token counts from prompt_tokens and completion_tokens", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.metrics": JSON.stringify({
            prompt_tokens: 100,
            completion_tokens: 50,
          }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["gen_ai.usage.input_tokens"]).toBe(100);
      expect(result.attributes["gen_ai.usage.output_tokens"]).toBe(50);
    });

    it("extracts a manually reported cost", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.metrics": JSON.stringify({ cost: 0.042 }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["langwatch.span.cost"]).toBe(0.042);
    });

    it("extracts reasoning tokens", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.metrics": JSON.stringify({ reasoning_tokens: 32 }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["gen_ai.usage.reasoning_tokens"]).toBe(32);
    });

    it("maps first_token_ms to gen_ai.server.time_to_first_token", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.metrics": JSON.stringify({ first_token_ms: 650 }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["gen_ai.server.time_to_first_token"]).toBe(650);
    });
  });

  describe("when semconv token attributes are already present", () => {
    it("keeps the semconv values over the metrics blob", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "gen_ai.usage.input_tokens": 200,
          "langwatch.metrics": JSON.stringify({ prompt_tokens: 100 }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["gen_ai.usage.input_tokens"]).toBe(200);
    });
  });

  describe("when the metrics blob is malformed", () => {
    it("ignores non-object payloads without throwing", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.metrics": JSON.stringify([1, 2, 3]),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["gen_ai.usage.input_tokens"]).toBeUndefined();
      expect(result.attributes["langwatch.span.cost"]).toBeUndefined();
    });

    it("ignores zero and negative token counts", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.metrics": JSON.stringify({
            prompt_tokens: 0,
            completion_tokens: -5,
          }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["gen_ai.usage.input_tokens"]).toBeUndefined();
      expect(result.attributes["gen_ai.usage.output_tokens"]).toBeUndefined();
    });
  });
});

// The Go SDK is dropping the langwatch.metrics token duplication and emitting
// usage only under gen_ai.usage.*. Python/TS SDKs still emit langwatch.metrics,
// so the backend reads BOTH — but the OTel GenAI semconv source is the default
// and WINS when both are present. Older SDKs that only emit langwatch.metrics
// keep working as the fallback.
//
// Spec: specs/ai-gateway/cache-token-telemetry.feature
describe("TraceCanonicalisationService — gen_ai is the default token source", () => {
  describe("given a span carries both gen_ai.usage.* and a langwatch.metrics token blob", () => {
    it("uses the gen_ai input/output token counts over the metrics blob", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          [ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]: 200,
          [ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS]: 80,
          [ATTR_KEYS.LANGWATCH_METRICS]: JSON.stringify({
            prompt_tokens: 100,
            completion_tokens: 40,
          }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBe(200);
      expect(result.attributes[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(80);
    });

    it("uses the gen_ai reasoning token count over the metrics blob", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          [ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS]: 512,
          [ATTR_KEYS.LANGWATCH_METRICS]: JSON.stringify({
            reasoning_tokens: 999,
          }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes[ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS]).toBe(512);
    });
  });

  describe("given a span carries only the langwatch.metrics token blob (older SDK)", () => {
    it("falls back to the metrics blob for input/output tokens", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          [ATTR_KEYS.LANGWATCH_METRICS]: JSON.stringify({
            prompt_tokens: 100,
            completion_tokens: 40,
          }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBe(100);
      expect(result.attributes[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(40);
    });

    it("falls back to the metrics blob for reasoning tokens", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          [ATTR_KEYS.LANGWATCH_METRICS]: JSON.stringify({
            reasoning_tokens: 999,
          }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes[ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS]).toBe(999);
    });
  });
});

// The Go SDK emits cache-read tokens as the flat gen_ai.usage.cached_input_tokens.
// Cost + the trace cache rollup only read the dotted form, so the flat alias is
// canonicalised onto gen_ai.usage.cache_read.input_tokens for any span — and the
// canonicalised count must reach the cost cascade.
//
// Spec: specs/ai-gateway/cache-token-telemetry.feature
describe("TraceCanonicalisationService — cache-read token canonicalisation", () => {
  describe("given a span emits the flat cached_input_tokens alias", () => {
    it("canonicalises it onto the dotted cache_read.input_tokens key", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          [ATTR_KEYS.GEN_AI_USAGE_CACHED_INPUT_TOKENS]: 37127,
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]).toBe(37127);
      expect(result.attributes[ATTR_KEYS.GEN_AI_USAGE_CACHED_INPUT_TOKENS]).toBeUndefined();
    });

    it("preserves the canonicalised cache count alongside the model", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          [ATTR_KEYS.GEN_AI_REQUEST_MODEL]: "claude-opus-4-7",
          [ATTR_KEYS.GEN_AI_USAGE_CACHED_INPUT_TOKENS]: 37127,
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes[ATTR_KEYS.GEN_AI_REQUEST_MODEL]).toBe("claude-opus-4-7");
      expect(result.attributes[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]).toBe(37127);
    });
  });

  describe("given a span emits BOTH the dotted form and the flat alias", () => {
    it("keeps the dotted cache_read.input_tokens over the flat alias", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          [ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]: 5000,
          [ATTR_KEYS.GEN_AI_USAGE_CACHED_INPUT_TOKENS]: 999,
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]).toBe(5000);
    });
  });
});

// The SDK now emits gen_ai.usage.cache_creation.input_tokens for ALL providers,
// including Bedrock (which previously only put it in an ignored blob). A
// Bedrock-shaped span must reach the cache-creation cost path.
//
// Spec: specs/trace-processing/bedrock-model-cost-matching.feature
describe("TraceCanonicalisationService — cache-creation across providers", () => {
  describe("given a Bedrock-shaped span emits cache_creation.input_tokens", () => {
    it("carries the count through", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          [ATTR_KEYS.GEN_AI_REQUEST_MODEL]: "bedrock/us.anthropic.claude-opus-4-7",
          [ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS]: 1000,
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes[ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS]).toBe(1000);
    });
  });
});
