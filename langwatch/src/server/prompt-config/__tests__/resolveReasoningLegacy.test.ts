import { describe, expect, it } from "vitest";
import { resolveReasoningToProviderParam } from "../resolveReasoningLegacy";

describe("resolveReasoningToProviderParam", () => {
  describe("provider-based mapping", () => {
    it("maps to reasoning_effort for OpenAI models", () => {
      const result = resolveReasoningToProviderParam("openai/gpt-4", "high");

      expect(result.key).toBe("reasoning_effort");
      expect(result.value).toBe("high");
    });

    it("maps to thinkingLevel for Google/Gemini models", () => {
      const result = resolveReasoningToProviderParam(
        "google/gemini-2.0-flash",
        "medium",
      );

      expect(result.key).toBe("thinkingLevel");
      expect(result.value).toBe("medium");
    });

    it("maps to effort for Anthropic models", () => {
      const result = resolveReasoningToProviderParam(
        "anthropic/claude-sonnet-4",
        "low",
      );

      expect(result.key).toBe("effort");
      expect(result.value).toBe("low");
    });
  });

  describe("fallback behavior", () => {
    it("defaults to reasoning_effort for unknown providers", () => {
      const result = resolveReasoningToProviderParam(
        "unknown-provider/model",
        "high",
      );

      expect(result.key).toBe("reasoning_effort");
      expect(result.value).toBe("high");
    });

    it("defaults to reasoning_effort for models without provider prefix", () => {
      const result = resolveReasoningToProviderParam("some-model", "medium");

      expect(result.key).toBe("reasoning_effort");
      expect(result.value).toBe("medium");
    });
  });

  describe("value preservation", () => {
    it("preserves the original value", () => {
      const result = resolveReasoningToProviderParam("openai/gpt-4", "custom");

      expect(result.value).toBe("custom");
    });
  });
});
