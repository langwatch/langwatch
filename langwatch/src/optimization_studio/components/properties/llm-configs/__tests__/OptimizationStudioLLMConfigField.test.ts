import { describe, it } from "vitest";

/**
 * Tests for OptimizationStudioLLMConfigField normalization logic
 *
 * The normalizeToSnakeCase function ensures LLM configs are in the correct
 * format (max_tokens not maxTokens) for the optimization studio DSL schema.
 */
describe("normalizeToSnakeCase", () => {
  describe("when maxTokens (camelCase) is present", () => {
    it.todo("converts maxTokens to max_tokens");
  });

  describe("when max_tokens (snake_case) is present", () => {
    it.todo("preserves max_tokens");
  });

  describe("when both maxTokens and max_tokens are present", () => {
    it.todo("prefers maxTokens value");
  });

  describe("when maxTokens is undefined", () => {
    it.todo("does not include max_tokens in result");
  });

  describe("when temperature is defined", () => {
    it.todo("includes temperature in result");
  });

  describe("when temperature is undefined", () => {
    it.todo("does not include temperature in result");
  });

  describe("when litellm_params is defined", () => {
    it.todo("includes litellm_params in result");
  });

  describe("when litellm_params is undefined", () => {
    it.todo("does not include litellm_params in result");
  });

  it.todo("always includes model in result");
});

describe("OptimizationStudioLLMConfigField handleChange", () => {
  describe("when newLlmConfig is undefined", () => {
    it.todo("calls onChange with undefined");
  });

  describe("when newLlmConfig is defined", () => {
    it.todo("calls onChange with normalized config");
  });
});
