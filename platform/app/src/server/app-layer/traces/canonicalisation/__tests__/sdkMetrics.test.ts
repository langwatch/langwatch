import { describe, expect, it } from "vitest";
import { CanonicalizeSpanAttributesService } from "../canonicalizeSpanAttributesService";
import { makeStubSpan } from "./_helpers";

const service = new CanonicalizeSpanAttributesService();

const stubSpan = makeStubSpan();

describe("CanonicalizeSpanAttributesService — langwatch.metrics handling", () => {
  describe("when the TypeScript SDK sends the structured metrics shape", () => {
    /** @scenario "TypeScript structured metrics keep working" */
    it("extracts token counts and cost from { type, value }", () => {
      const result = service.canonicalize(
        {
          "langwatch.metrics": JSON.stringify({
            type: "json",
            value: { promptTokens: 10, completionTokens: 5, cost: 0.001 },
          }),
        },
        [],
        stubSpan,
      );

      expect(result.attributes["gen_ai.usage.input_tokens"]).toBe(10);
      expect(result.attributes["gen_ai.usage.output_tokens"]).toBe(5);
      expect(result.attributes["langwatch.span.cost"]).toBe(0.001);
    });

    it("extracts the tokensEstimated flag", () => {
      const result = service.canonicalize(
        {
          "langwatch.metrics": JSON.stringify({
            type: "json",
            value: { promptTokens: 10, tokensEstimated: true },
          }),
        },
        [],
        stubSpan,
      );

      expect(result.attributes["langwatch.tokens.estimated"]).toBe(true);
    });
  });

  describe("when the Python SDK sends the bare snake_case metrics shape", () => {
    /** @scenario "Bare snake_case metrics provide token counts" */
    it("extracts token counts from prompt_tokens and completion_tokens", () => {
      const result = service.canonicalize(
        {
          "langwatch.metrics": JSON.stringify({
            prompt_tokens: 100,
            completion_tokens: 50,
          }),
        },
        [],
        stubSpan,
      );

      expect(result.attributes["gen_ai.usage.input_tokens"]).toBe(100);
      expect(result.attributes["gen_ai.usage.output_tokens"]).toBe(50);
    });

    /** @scenario "Bare snake_case metrics provide a manual cost" */
    it("extracts a manually reported cost", () => {
      const result = service.canonicalize(
        {
          "langwatch.metrics": JSON.stringify({ cost: 0.042 }),
        },
        [],
        stubSpan,
      );

      expect(result.attributes["langwatch.span.cost"]).toBe(0.042);
    });

    /** @scenario "Bare snake_case metrics provide reasoning tokens" */
    it("extracts reasoning tokens", () => {
      const result = service.canonicalize(
        {
          "langwatch.metrics": JSON.stringify({ reasoning_tokens: 32 }),
        },
        [],
        stubSpan,
      );

      expect(result.attributes["gen_ai.usage.reasoning_tokens"]).toBe(32);
    });

    /** @scenario "Bare snake_case metrics provide time to first token as a duration" */
    it("maps first_token_ms to gen_ai.server.time_to_first_token", () => {
      const result = service.canonicalize(
        {
          "langwatch.metrics": JSON.stringify({ first_token_ms: 650 }),
        },
        [],
        stubSpan,
      );

      expect(result.attributes["gen_ai.server.time_to_first_token"]).toBe(650);
    });
  });

  describe("when semconv token attributes are already present", () => {
    /** @scenario "Semconv attributes win over the metrics blob" */
    it("keeps the semconv values over the metrics blob", () => {
      const result = service.canonicalize(
        {
          "gen_ai.usage.input_tokens": 200,
          "langwatch.metrics": JSON.stringify({ prompt_tokens: 100 }),
        },
        [],
        stubSpan,
      );

      expect(result.attributes["gen_ai.usage.input_tokens"]).toBe(200);
    });
  });

  describe("when the metrics blob is malformed", () => {
    it("ignores non-object payloads without throwing", () => {
      const result = service.canonicalize(
        {
          "langwatch.metrics": JSON.stringify([1, 2, 3]),
        },
        [],
        stubSpan,
      );

      expect(result.attributes["gen_ai.usage.input_tokens"]).toBeUndefined();
      expect(result.attributes["langwatch.span.cost"]).toBeUndefined();
    });

    it("ignores zero and negative token counts", () => {
      const result = service.canonicalize(
        {
          "langwatch.metrics": JSON.stringify({
            prompt_tokens: 0,
            completion_tokens: -5,
          }),
        },
        [],
        stubSpan,
      );

      expect(result.attributes["gen_ai.usage.input_tokens"]).toBeUndefined();
      expect(result.attributes["gen_ai.usage.output_tokens"]).toBeUndefined();
    });
  });
});
