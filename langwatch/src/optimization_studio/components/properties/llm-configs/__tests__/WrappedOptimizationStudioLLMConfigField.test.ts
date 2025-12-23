import { describe, expect, it } from "vitest";
import type { LLMConfig } from "~/optimization_studio/types/dsl";
import { LLMConfigFormatUtils } from "../llm-config-format-utils";

/**
 * Tests for WrappedOptimizationStudioLLMConfigField conversion functions
 *
 * These functions handle the boundary between form format (camelCase) and DSL format (snake_case).
 */
describe("formToDslFormat", () => {
  describe("when converting form format to DSL format", () => {
    it("converts maxTokens to max_tokens", () => {
      const formConfig = { model: "test", maxTokens: 1000 };
      const result = LLMConfigFormatUtils.formToDslFormat(formConfig);
      expect(result.max_tokens).toBe(1000);
    });

    it("converts litellmParams to litellm_params", () => {
      const formConfig = { model: "test", litellmParams: { key: "value" } };
      const result = LLMConfigFormatUtils.formToDslFormat(formConfig);
      expect(result.litellm_params).toEqual({ key: "value" });
    });

    it("preserves model field", () => {
      const formConfig = { model: "openai/gpt-4" };
      const result = LLMConfigFormatUtils.formToDslFormat(formConfig);
      expect(result.model).toBe("openai/gpt-4");
    });

    it("preserves temperature field", () => {
      const formConfig = { model: "test", temperature: 0.7 };
      const result = LLMConfigFormatUtils.formToDslFormat(formConfig);
      expect(result.temperature).toBe(0.7);
    });
  });
});

describe("dslToFormFormat", () => {
  describe("when converting DSL format to form format", () => {
    it("converts max_tokens to maxTokens", () => {
      const dslConfig: LLMConfig = { model: "test", max_tokens: 2000 };
      const result = LLMConfigFormatUtils.dslToFormFormat(dslConfig);
      expect(result.maxTokens).toBe(2000);
    });

    it("converts litellm_params to litellmParams", () => {
      const dslConfig: LLMConfig = {
        model: "test",
        litellm_params: { param: "value" },
      };
      const result = LLMConfigFormatUtils.dslToFormFormat(dslConfig);
      expect(result.litellmParams).toEqual({ param: "value" });
    });

    it("preserves model field", () => {
      const dslConfig: LLMConfig = { model: "openai/gpt-4" };
      const result = LLMConfigFormatUtils.dslToFormFormat(dslConfig);
      expect(result.model).toBe("openai/gpt-4");
    });

    it("preserves temperature field", () => {
      const dslConfig: LLMConfig = { model: "test", temperature: 0.8 };
      const result = LLMConfigFormatUtils.dslToFormFormat(dslConfig);
      expect(result.temperature).toBe(0.8);
    });
  });
});
