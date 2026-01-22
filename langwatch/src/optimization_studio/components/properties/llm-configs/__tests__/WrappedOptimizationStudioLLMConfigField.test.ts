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
      const formConfig = { model: "test", maxTokens: 4096 };
      const result = LLMConfigFormatUtils.formToDslFormat(formConfig);
      expect(result.max_tokens).toBe(4096);
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

    // Traditional sampling parameters
    it("converts topP to top_p", () => {
      const formConfig = { model: "test", topP: 0.9 };
      const result = LLMConfigFormatUtils.formToDslFormat(formConfig);
      expect(result.top_p).toBe(0.9);
    });

    it("converts frequencyPenalty to frequency_penalty", () => {
      const formConfig = { model: "test", frequencyPenalty: 0.5 };
      const result = LLMConfigFormatUtils.formToDslFormat(formConfig);
      expect(result.frequency_penalty).toBe(0.5);
    });

    it("converts presencePenalty to presence_penalty", () => {
      const formConfig = { model: "test", presencePenalty: 0.3 };
      const result = LLMConfigFormatUtils.formToDslFormat(formConfig);
      expect(result.presence_penalty).toBe(0.3);
    });

    // Other sampling parameters
    it("preserves seed field", () => {
      const formConfig = { model: "test", seed: 42 };
      const result = LLMConfigFormatUtils.formToDslFormat(formConfig);
      expect(result.seed).toBe(42);
    });

    it("converts topK to top_k", () => {
      const formConfig = { model: "test", topK: 40 };
      const result = LLMConfigFormatUtils.formToDslFormat(formConfig);
      expect(result.top_k).toBe(40);
    });

    it("converts minP to min_p", () => {
      const formConfig = { model: "test", minP: 0.05 };
      const result = LLMConfigFormatUtils.formToDslFormat(formConfig);
      expect(result.min_p).toBe(0.05);
    });

    it("converts repetitionPenalty to repetition_penalty", () => {
      const formConfig = { model: "test", repetitionPenalty: 1.1 };
      const result = LLMConfigFormatUtils.formToDslFormat(formConfig);
      expect(result.repetition_penalty).toBe(1.1);
    });

    // Reasoning parameter (canonical/unified field)
    it("passes reasoning through unchanged", () => {
      const formConfig = { model: "test", reasoning: "medium" };
      const result = LLMConfigFormatUtils.formToDslFormat(formConfig);
      expect(result.reasoning).toBe("medium");
    });

    it("preserves verbosity field", () => {
      const formConfig = { model: "test", verbosity: "verbose" };
      const result = LLMConfigFormatUtils.formToDslFormat(formConfig);
      expect(result.verbosity).toBe("verbose");
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

    // Traditional sampling parameters
    it("converts top_p to topP", () => {
      const dslConfig: LLMConfig = { model: "test", top_p: 0.9 };
      const result = LLMConfigFormatUtils.dslToFormFormat(dslConfig);
      expect(result.topP).toBe(0.9);
    });

    it("converts frequency_penalty to frequencyPenalty", () => {
      const dslConfig: LLMConfig = { model: "test", frequency_penalty: 0.5 };
      const result = LLMConfigFormatUtils.dslToFormFormat(dslConfig);
      expect(result.frequencyPenalty).toBe(0.5);
    });

    it("converts presence_penalty to presencePenalty", () => {
      const dslConfig: LLMConfig = { model: "test", presence_penalty: 0.3 };
      const result = LLMConfigFormatUtils.dslToFormFormat(dslConfig);
      expect(result.presencePenalty).toBe(0.3);
    });

    // Other sampling parameters
    it("preserves seed field", () => {
      const dslConfig: LLMConfig = { model: "test", seed: 42 };
      const result = LLMConfigFormatUtils.dslToFormFormat(dslConfig);
      expect(result.seed).toBe(42);
    });

    it("converts top_k to topK", () => {
      const dslConfig: LLMConfig = { model: "test", top_k: 40 };
      const result = LLMConfigFormatUtils.dslToFormFormat(dslConfig);
      expect(result.topK).toBe(40);
    });

    it("converts min_p to minP", () => {
      const dslConfig: LLMConfig = { model: "test", min_p: 0.05 };
      const result = LLMConfigFormatUtils.dslToFormFormat(dslConfig);
      expect(result.minP).toBe(0.05);
    });

    it("converts repetition_penalty to repetitionPenalty", () => {
      const dslConfig: LLMConfig = { model: "test", repetition_penalty: 1.1 };
      const result = LLMConfigFormatUtils.dslToFormFormat(dslConfig);
      expect(result.repetitionPenalty).toBe(1.1);
    });

    // Unified reasoning parameter (normalizes from any provider-specific field)
    it("normalizes reasoning_effort to reasoning", () => {
      const dslConfig: LLMConfig = { model: "test", reasoning_effort: "medium" };
      const result = LLMConfigFormatUtils.dslToFormFormat(dslConfig);
      expect(result.reasoning).toBe("medium");
    });

    it("preserves verbosity field", () => {
      const dslConfig: LLMConfig = { model: "test", verbosity: "verbose" };
      const result = LLMConfigFormatUtils.dslToFormFormat(dslConfig);
      expect(result.verbosity).toBe("verbose");
    });
  });
});

describe("round-trip conversion", () => {
  it("form -> DSL -> form preserves all values", () => {
    const originalForm = {
      model: "openai/gpt-4",
      temperature: 0.7,
      maxTokens: 4096,
      topP: 0.9,
      frequencyPenalty: 0.5,
      presencePenalty: 0.3,
      seed: 42,
      topK: 40,
      minP: 0.05,
      repetitionPenalty: 1.1,
      reasoning: "medium", // Unified reasoning field
      verbosity: "verbose",
      litellmParams: { key: "value" },
    };

    const dsl = LLMConfigFormatUtils.formToDslFormat(originalForm);
    const roundTripped = LLMConfigFormatUtils.dslToFormFormat(dsl);

    expect(roundTripped).toEqual(originalForm);
  });

  it("DSL -> form -> DSL preserves all values with unified reasoning", () => {
    // DSL with unified reasoning field
    const originalDsl: LLMConfig = {
      model: "openai/gpt-4",
      temperature: 0.7,
      max_tokens: 4096,
      top_p: 0.9,
      frequency_penalty: 0.5,
      presence_penalty: 0.3,
      seed: 42,
      top_k: 40,
      min_p: 0.05,
      repetition_penalty: 1.1,
      reasoning: "medium", // Unified reasoning field
      verbosity: "verbose",
      litellm_params: { key: "value" },
    };

    const form = LLMConfigFormatUtils.dslToFormFormat(originalDsl);
    const roundTripped = LLMConfigFormatUtils.formToDslFormat(form);

    expect(roundTripped).toEqual(originalDsl);
  });

  it("DSL with legacy reasoning_effort normalizes to unified reasoning", () => {
    // Legacy DSL with reasoning_effort (backward compatibility)
    const legacyDsl: LLMConfig = {
      model: "openai/gpt-4",
      temperature: 0.7,
      max_tokens: 4096,
      reasoning_effort: "high", // Legacy field
      verbosity: "verbose",
    };

    const form = LLMConfigFormatUtils.dslToFormFormat(legacyDsl);

    // Form should have unified reasoning
    expect(form.reasoning).toBe("high");

    // Round-trip writes unified reasoning
    const roundTripped = LLMConfigFormatUtils.formToDslFormat(form);
    expect(roundTripped.reasoning).toBe("high");
    expect(roundTripped.reasoning_effort).toBeUndefined();
  });
});
