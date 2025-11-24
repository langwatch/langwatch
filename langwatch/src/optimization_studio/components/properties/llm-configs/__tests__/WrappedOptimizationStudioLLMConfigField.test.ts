import { describe, it } from "vitest";

/**
 * Tests for WrappedOptimizationStudioLLMConfigField conversion functions
 *
 * These functions handle the boundary between form format (camelCase) and DSL format (snake_case).
 */
describe("formToDslFormat", () => {
  describe("when converting form format to DSL format", () => {
    it.todo("converts maxTokens to max_tokens");

    it.todo("converts litellmParams to litellm_params");

    it.todo("preserves model field");

    it.todo("preserves temperature field");
  });
});

describe("dslToFormFormat", () => {
  describe("when dslLlm is falsy", () => {
    it.todo("returns the falsy value unchanged");
  });

  describe("when dslLlm is truthy", () => {
    it.todo("converts max_tokens to maxTokens");

    it.todo("converts litellm_params to litellmParams");

    it.todo("preserves model field");

    it.todo("preserves temperature field");
  });
});
