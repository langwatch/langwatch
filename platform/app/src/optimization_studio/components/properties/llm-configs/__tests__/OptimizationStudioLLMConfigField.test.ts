import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL } from "~/utils/constants";
import { normalizeToSnakeCase } from "../normalizeToSnakeCase";

/**
 * Tests for OptimizationStudioLLMConfigField normalization logic
 *
 * The normalizeToSnakeCase function ensures LLM configs are in the correct
 * format (max_tokens not maxTokens) for the optimization studio DSL schema.
 */
describe("normalizeToSnakeCase", () => {
  describe("maxTokens normalization", () => {
    it("converts maxTokens to max_tokens", () => {
      const input = { model: DEFAULT_MODEL, maxTokens: 4096 };
      const result = normalizeToSnakeCase(input);
      expect(result.max_tokens).toBe(4096);
      expect((result as Record<string, unknown>).maxTokens).toBeUndefined();
    });

    it("preserves max_tokens when maxTokens is not present", () => {
      const input = { model: DEFAULT_MODEL, max_tokens: 2000 };
      const result = normalizeToSnakeCase(input);
      expect(result.max_tokens).toBe(2000);
    });

    it("prefers maxTokens over max_tokens when both present", () => {
      const input = { model: DEFAULT_MODEL, maxTokens: 4096, max_tokens: 2000 };
      const result = normalizeToSnakeCase(input);
      expect(result.max_tokens).toBe(4096);
    });
  });

  describe("preserves all parameters", () => {
    it("preserves model", () => {
      const input = { model: DEFAULT_MODEL };
      const result = normalizeToSnakeCase(input);
      expect(result.model).toBe(DEFAULT_MODEL);
    });

    it("preserves temperature", () => {
      const input = { model: DEFAULT_MODEL, temperature: 0.7 };
      const result = normalizeToSnakeCase(input);
      expect(result.temperature).toBe(0.7);
    });

    it("preserves litellm_params", () => {
      const input = { model: DEFAULT_MODEL, litellm_params: { key: "value" } };
      const result = normalizeToSnakeCase(input);
      expect(result.litellm_params).toEqual({ key: "value" });
    });

    // Reasoning parameter (unified)
    it("preserves reasoning parameter", () => {
      const input = { model: DEFAULT_MODEL, reasoning: "medium" };
      const result = normalizeToSnakeCase(input);
      expect(result.reasoning).toBe("medium");
    });

    it("preserves verbosity parameter", () => {
      const input = { model: DEFAULT_MODEL, verbosity: "verbose" };
      const result = normalizeToSnakeCase(input);
      expect(result.verbosity).toBe("verbose");
    });

    // Traditional sampling parameters - these currently FAIL due to the bug
    it("preserves top_p parameter", () => {
      const input = { model: DEFAULT_MODEL, top_p: 0.9 };
      const result = normalizeToSnakeCase(input);
      expect(result.top_p).toBe(0.9);
    });

    it("preserves frequency_penalty parameter", () => {
      const input = { model: DEFAULT_MODEL, frequency_penalty: 0.5 };
      const result = normalizeToSnakeCase(input);
      expect(result.frequency_penalty).toBe(0.5);
    });

    it("preserves presence_penalty parameter", () => {
      const input = { model: DEFAULT_MODEL, presence_penalty: 0.3 };
      const result = normalizeToSnakeCase(input);
      expect(result.presence_penalty).toBe(0.3);
    });

    it("preserves seed parameter", () => {
      const input = { model: DEFAULT_MODEL, seed: 42 };
      const result = normalizeToSnakeCase(input);
      expect(result.seed).toBe(42);
    });

    it("preserves top_k parameter", () => {
      const input = { model: DEFAULT_MODEL, top_k: 40 };
      const result = normalizeToSnakeCase(input);
      expect(result.top_k).toBe(40);
    });

    it("preserves min_p parameter", () => {
      const input = { model: DEFAULT_MODEL, min_p: 0.05 };
      const result = normalizeToSnakeCase(input);
      expect(result.min_p).toBe(0.05);
    });

    it("preserves repetition_penalty parameter", () => {
      const input = { model: DEFAULT_MODEL, repetition_penalty: 1.1 };
      const result = normalizeToSnakeCase(input);
      expect(result.repetition_penalty).toBe(1.1);
    });
  });

  describe("converts camelCase to snake_case", () => {
    it("converts topP to top_p", () => {
      const input = { model: DEFAULT_MODEL, topP: 0.9 };
      const result = normalizeToSnakeCase(input);
      expect(result.top_p).toBe(0.9);
      expect((result as Record<string, unknown>).topP).toBeUndefined();
    });

    it("converts frequencyPenalty to frequency_penalty", () => {
      const input = { model: DEFAULT_MODEL, frequencyPenalty: 0.5 };
      const result = normalizeToSnakeCase(input);
      expect(result.frequency_penalty).toBe(0.5);
      expect(
        (result as Record<string, unknown>).frequencyPenalty,
      ).toBeUndefined();
    });

    it("converts presencePenalty to presence_penalty", () => {
      const input = { model: DEFAULT_MODEL, presencePenalty: 0.3 };
      const result = normalizeToSnakeCase(input);
      expect(result.presence_penalty).toBe(0.3);
      expect(
        (result as Record<string, unknown>).presencePenalty,
      ).toBeUndefined();
    });

    it("converts topK to top_k", () => {
      const input = { model: DEFAULT_MODEL, topK: 40 };
      const result = normalizeToSnakeCase(input);
      expect(result.top_k).toBe(40);
      expect((result as Record<string, unknown>).topK).toBeUndefined();
    });

    it("converts minP to min_p", () => {
      const input = { model: DEFAULT_MODEL, minP: 0.05 };
      const result = normalizeToSnakeCase(input);
      expect(result.min_p).toBe(0.05);
      expect((result as Record<string, unknown>).minP).toBeUndefined();
    });

    it("converts repetitionPenalty to repetition_penalty", () => {
      const input = { model: DEFAULT_MODEL, repetitionPenalty: 1.1 };
      const result = normalizeToSnakeCase(input);
      expect(result.repetition_penalty).toBe(1.1);
      expect(
        (result as Record<string, unknown>).repetitionPenalty,
      ).toBeUndefined();
    });

    // Note: reasoning passes through unchanged (no camelCase variant exists)
    // Provider-specific mapping (reasoning → reasoning_effort) happens at runtime boundary
    it("reasoning passes through unchanged", () => {
      const input = { model: DEFAULT_MODEL, reasoning: "medium" };
      const result = normalizeToSnakeCase(input);
      expect(result.reasoning).toBe("medium");
    });
  });
});
