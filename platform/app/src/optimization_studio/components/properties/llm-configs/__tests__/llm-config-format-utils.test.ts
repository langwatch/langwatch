import { describe, expect, it } from "vitest";
import type { LLMConfig } from "~/optimization_studio/types/dsl";
import {
  type FormLLMConfig,
  LLMConfigFormatUtils,
} from "../llm-config-format-utils";

describe("LLMConfigFormatUtils", () => {
  describe("formToDslFormat", () => {
    it("converts model", () => {
      const form: FormLLMConfig = { model: "openai/gpt-4" };
      const result = LLMConfigFormatUtils.formToDslFormat(form);
      expect(result.model).toBe("openai/gpt-4");
    });

    it("converts maxTokens to max_tokens", () => {
      const form: FormLLMConfig = { model: "gpt-4", maxTokens: 4096 };
      const result = LLMConfigFormatUtils.formToDslFormat(form);
      expect(result.max_tokens).toBe(4096);
    });

    it("converts topP to top_p", () => {
      const form: FormLLMConfig = { model: "gpt-4", topP: 0.9 };
      const result = LLMConfigFormatUtils.formToDslFormat(form);
      expect(result.top_p).toBe(0.9);
    });

    it("converts frequencyPenalty to frequency_penalty", () => {
      const form: FormLLMConfig = { model: "gpt-4", frequencyPenalty: 0.5 };
      const result = LLMConfigFormatUtils.formToDslFormat(form);
      expect(result.frequency_penalty).toBe(0.5);
    });

    it("converts presencePenalty to presence_penalty", () => {
      const form: FormLLMConfig = { model: "gpt-4", presencePenalty: 0.3 };
      const result = LLMConfigFormatUtils.formToDslFormat(form);
      expect(result.presence_penalty).toBe(0.3);
    });

    it("converts topK to top_k", () => {
      const form: FormLLMConfig = { model: "gpt-4", topK: 40 };
      const result = LLMConfigFormatUtils.formToDslFormat(form);
      expect(result.top_k).toBe(40);
    });

    it("converts minP to min_p", () => {
      const form: FormLLMConfig = { model: "gpt-4", minP: 0.05 };
      const result = LLMConfigFormatUtils.formToDslFormat(form);
      expect(result.min_p).toBe(0.05);
    });

    it("converts repetitionPenalty to repetition_penalty", () => {
      const form: FormLLMConfig = { model: "gpt-4", repetitionPenalty: 1.1 };
      const result = LLMConfigFormatUtils.formToDslFormat(form);
      expect(result.repetition_penalty).toBe(1.1);
    });

    it("converts unified reasoning field", () => {
      const form: FormLLMConfig = { model: "gpt-5", reasoning: "high" };
      const result = LLMConfigFormatUtils.formToDslFormat(form);
      expect(result.reasoning).toBe("high");
    });

    it("converts all parameters in complete config", () => {
      const form: FormLLMConfig = {
        model: "gpt-4",
        temperature: 0.7,
        maxTokens: 4096,
        topP: 0.9,
        frequencyPenalty: 0.5,
        presencePenalty: 0.3,
        seed: 42,
        topK: 40,
        minP: 0.05,
        repetitionPenalty: 1.1,
        reasoning: "medium",
        verbosity: "verbose",
      };
      const result = LLMConfigFormatUtils.formToDslFormat(form);

      expect(result.model).toBe("gpt-4");
      expect(result.temperature).toBe(0.7);
      expect(result.max_tokens).toBe(4096);
      expect(result.top_p).toBe(0.9);
      expect(result.frequency_penalty).toBe(0.5);
      expect(result.presence_penalty).toBe(0.3);
      expect(result.seed).toBe(42);
      expect(result.top_k).toBe(40);
      expect(result.min_p).toBe(0.05);
      expect(result.repetition_penalty).toBe(1.1);
      expect(result.reasoning).toBe("medium");
      expect(result.verbosity).toBe("verbose");
    });
  });

  describe("dslToFormFormat", () => {
    it("converts model", () => {
      const dsl: LLMConfig = { model: "openai/gpt-4" };
      const result = LLMConfigFormatUtils.dslToFormFormat(dsl);
      expect(result.model).toBe("openai/gpt-4");
    });

    it("converts max_tokens to maxTokens", () => {
      const dsl: LLMConfig = { model: "gpt-4", max_tokens: 4096 };
      const result = LLMConfigFormatUtils.dslToFormFormat(dsl);
      expect(result.maxTokens).toBe(4096);
    });

    it("converts top_p to topP", () => {
      const dsl: LLMConfig = { model: "gpt-4", top_p: 0.9 };
      const result = LLMConfigFormatUtils.dslToFormFormat(dsl);
      expect(result.topP).toBe(0.9);
    });

    it("converts frequency_penalty to frequencyPenalty", () => {
      const dsl: LLMConfig = { model: "gpt-4", frequency_penalty: 0.5 };
      const result = LLMConfigFormatUtils.dslToFormFormat(dsl);
      expect(result.frequencyPenalty).toBe(0.5);
    });

    it("converts presence_penalty to presencePenalty", () => {
      const dsl: LLMConfig = { model: "gpt-4", presence_penalty: 0.3 };
      const result = LLMConfigFormatUtils.dslToFormFormat(dsl);
      expect(result.presencePenalty).toBe(0.3);
    });

    it("converts top_k to topK", () => {
      const dsl: LLMConfig = { model: "gpt-4", top_k: 40 };
      const result = LLMConfigFormatUtils.dslToFormFormat(dsl);
      expect(result.topK).toBe(40);
    });

    it("converts min_p to minP", () => {
      const dsl: LLMConfig = { model: "gpt-4", min_p: 0.05 };
      const result = LLMConfigFormatUtils.dslToFormFormat(dsl);
      expect(result.minP).toBe(0.05);
    });

    it("converts repetition_penalty to repetitionPenalty", () => {
      const dsl: LLMConfig = { model: "gpt-4", repetition_penalty: 1.1 };
      const result = LLMConfigFormatUtils.dslToFormFormat(dsl);
      expect(result.repetitionPenalty).toBe(1.1);
    });

    it("normalizes reasoning field from canonical reasoning", () => {
      const dsl: LLMConfig = { model: "gpt-5", reasoning: "high" };
      const result = LLMConfigFormatUtils.dslToFormFormat(dsl);
      expect(result.reasoning).toBe("high");
    });

    it("normalizes reasoning from legacy reasoning_effort (OpenAI)", () => {
      const dsl: LLMConfig = { model: "gpt-5", reasoning_effort: "high" };
      const result = LLMConfigFormatUtils.dslToFormFormat(dsl);
      expect(result.reasoning).toBe("high");
    });

    it("normalizes reasoning from legacy thinkingLevel (Gemini)", () => {
      const dsl: LLMConfig = { model: "gemini-2.5-pro", thinkingLevel: "high" };
      const result = LLMConfigFormatUtils.dslToFormFormat(dsl);
      expect(result.reasoning).toBe("high");
    });

    it("normalizes reasoning from legacy effort (Anthropic)", () => {
      const dsl: LLMConfig = { model: "claude-opus-4.5", effort: "high" };
      const result = LLMConfigFormatUtils.dslToFormFormat(dsl);
      expect(result.reasoning).toBe("high");
    });

    it("reasoning takes precedence over legacy fields", () => {
      const dsl: LLMConfig = {
        model: "gpt-5",
        reasoning: "high",
        reasoning_effort: "low",
        thinkingLevel: "medium",
      };
      const result = LLMConfigFormatUtils.dslToFormFormat(dsl);
      expect(result.reasoning).toBe("high");
    });

    it("converts all parameters in complete config", () => {
      const dsl: LLMConfig = {
        model: "gpt-4",
        temperature: 0.7,
        max_tokens: 4096,
        top_p: 0.9,
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
        seed: 42,
        top_k: 40,
        min_p: 0.05,
        repetition_penalty: 1.1,
        reasoning: "medium",
        verbosity: "verbose",
      };
      const result = LLMConfigFormatUtils.dslToFormFormat(dsl);

      expect(result.model).toBe("gpt-4");
      expect(result.temperature).toBe(0.7);
      expect(result.maxTokens).toBe(4096);
      expect(result.topP).toBe(0.9);
      expect(result.frequencyPenalty).toBe(0.5);
      expect(result.presencePenalty).toBe(0.3);
      expect(result.seed).toBe(42);
      expect(result.topK).toBe(40);
      expect(result.minP).toBe(0.05);
      expect(result.repetitionPenalty).toBe(1.1);
      expect(result.reasoning).toBe("medium");
      expect(result.verbosity).toBe("verbose");
    });
  });

  describe("round-trip conversion", () => {
    it("preserves all values through form -> dsl -> form", () => {
      const original: FormLLMConfig = {
        model: "gpt-4",
        temperature: 0.7,
        maxTokens: 4096,
        topP: 0.9,
        reasoning: "high",
        verbosity: "verbose",
      };

      const dsl = LLMConfigFormatUtils.formToDslFormat(original);
      const roundTrip = LLMConfigFormatUtils.dslToFormFormat(dsl);

      expect(roundTrip.model).toBe(original.model);
      expect(roundTrip.temperature).toBe(original.temperature);
      expect(roundTrip.maxTokens).toBe(original.maxTokens);
      expect(roundTrip.topP).toBe(original.topP);
      expect(roundTrip.reasoning).toBe(original.reasoning);
      expect(roundTrip.verbosity).toBe(original.verbosity);
    });

    it("preserves all values through dsl -> form -> dsl", () => {
      const original: LLMConfig = {
        model: "claude-opus-4.5",
        temperature: 1.0,
        max_tokens: 8192,
        top_p: 0.95,
        reasoning: "high",
        verbosity: "verbose",
      };

      const form = LLMConfigFormatUtils.dslToFormFormat(original);
      const roundTrip = LLMConfigFormatUtils.formToDslFormat(form);

      expect(roundTrip.model).toBe(original.model);
      expect(roundTrip.temperature).toBe(original.temperature);
      expect(roundTrip.max_tokens).toBe(original.max_tokens);
      expect(roundTrip.top_p).toBe(original.top_p);
      expect(roundTrip.reasoning).toBe(original.reasoning);
      expect(roundTrip.verbosity).toBe(original.verbosity);
    });
  });
});
