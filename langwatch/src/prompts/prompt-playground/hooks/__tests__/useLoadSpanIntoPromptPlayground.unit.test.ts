import { describe, it, expect } from "vitest";
import {
  createDefaultPromptFormValues,
  coerceToNumber,
  coerceToString,
} from "../useLoadSpanIntoPromptPlayground";
import { DEFAULT_MODEL } from "~/utils/constants";
import type { RouterOutputs } from "~/utils/api";

type SpanData = RouterOutputs["spans"]["getForPromptStudio"];

function buildSpanData(
  overrides: Partial<SpanData["llmConfig"]> = {},
): SpanData {
  return {
    spanId: "span-1",
    traceId: "trace-1",
    spanName: "test-span",
    messages: [],
    llmConfig: {
      model: "openai/gpt-4",
      systemPrompt: "You are a helpful assistant.",
      temperature: 0.5,
      maxTokens: 512,
      topP: null,
      frequencyPenalty: null,
      presencePenalty: null,
      seed: null,
      topK: null,
      minP: null,
      repetitionPenalty: null,
      reasoning: null,
      verbosity: null,
      litellmParams: {},
      ...overrides,
    },
    vendor: "openai",
    error: null,
    timestamps: undefined,
    metrics: null,
    promptHandle: null,
    promptVersionNumber: null,
    promptVariables: null,
    promptLabel: null,
  };
}

describe("coerceToNumber()", () => {
  describe("when value is a number", () => {
    it("returns the number as-is", () => {
      expect(coerceToNumber(0.7)).toBe(0.7);
    });

    it("returns zero", () => {
      expect(coerceToNumber(0)).toBe(0);
    });

    it("returns undefined for NaN", () => {
      expect(coerceToNumber(NaN)).toBeUndefined();
    });

    it("returns undefined for Infinity", () => {
      expect(coerceToNumber(Infinity)).toBeUndefined();
    });
  });

  describe("when value is a string", () => {
    it("parses a numeric string", () => {
      expect(coerceToNumber("0.7")).toBe(0.7);
    });

    it("parses an integer string", () => {
      expect(coerceToNumber("1024")).toBe(1024);
    });

    it("trims whitespace before parsing", () => {
      expect(coerceToNumber("  0.9  ")).toBe(0.9);
    });

    it("returns undefined for empty string", () => {
      expect(coerceToNumber("")).toBeUndefined();
    });

    it("returns undefined for non-numeric string", () => {
      expect(coerceToNumber("not-a-number")).toBeUndefined();
    });
  });

  describe("when value is null or undefined", () => {
    it("returns undefined for null", () => {
      expect(coerceToNumber(null)).toBeUndefined();
    });

    it("returns undefined for undefined", () => {
      expect(coerceToNumber(undefined)).toBeUndefined();
    });
  });

  describe("when value is an unsupported type", () => {
    it("returns undefined for boolean", () => {
      expect(coerceToNumber(true)).toBeUndefined();
    });

    it("returns undefined for object", () => {
      expect(coerceToNumber({ value: 0.5 })).toBeUndefined();
    });

    it("returns undefined for array", () => {
      expect(coerceToNumber([0.5])).toBeUndefined();
    });
  });
});

describe("coerceToString()", () => {
  describe("when value is a string", () => {
    it("returns the string as-is", () => {
      expect(coerceToString("medium")).toBe("medium");
    });

    it("returns undefined for empty string", () => {
      expect(coerceToString("")).toBeUndefined();
    });
  });

  describe("when value is a number", () => {
    it("converts a finite number to string", () => {
      expect(coerceToString(42)).toBe("42");
    });

    it("returns undefined for NaN", () => {
      expect(coerceToString(NaN)).toBeUndefined();
    });

    it("returns undefined for Infinity", () => {
      expect(coerceToString(Infinity)).toBeUndefined();
    });
  });

  describe("when value is a boolean", () => {
    it("converts true to string", () => {
      expect(coerceToString(true)).toBe("true");
    });

    it("converts false to string", () => {
      expect(coerceToString(false)).toBe("false");
    });
  });

  describe("when value is null or undefined", () => {
    it("returns undefined for null", () => {
      expect(coerceToString(null)).toBeUndefined();
    });

    it("returns undefined for undefined", () => {
      expect(coerceToString(undefined)).toBeUndefined();
    });
  });

  describe("when value is an unsupported type", () => {
    it("returns undefined for object", () => {
      expect(coerceToString({ value: "foo" })).toBeUndefined();
    });

    it("returns undefined for array", () => {
      expect(coerceToString(["foo"])).toBeUndefined();
    });
  });
});

describe("createDefaultPromptFormValues()", () => {
  describe("when maxTokens is null", () => {
    it("creates form values successfully with undefined maxTokens", () => {
      const spanData = buildSpanData({ maxTokens: null });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.maxTokens).toBeUndefined();
    });
  });

  describe("when temperature is null", () => {
    it("creates form values successfully with undefined temperature", () => {
      const spanData = buildSpanData({ temperature: null });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.temperature).toBeUndefined();
    });
  });

  describe("when all LLM config values are present", () => {
    it("preserves maxTokens value", () => {
      const spanData = buildSpanData({ maxTokens: 1024, temperature: 0.7 });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.maxTokens).toBe(1024);
    });

    it("preserves temperature value", () => {
      const spanData = buildSpanData({ maxTokens: 1024, temperature: 0.7 });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.temperature).toBe(0.7);
    });
  });

  describe("when no model is specified", () => {
    it("uses the default model", () => {
      const spanData = buildSpanData({ model: null });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.model).toBe(DEFAULT_MODEL);
    });
  });

  describe("when all numeric parameters are present", () => {
    it("populates all numeric parameters in the form", () => {
      const spanData = buildSpanData({
        temperature: 0.8,
        maxTokens: 2048,
        topP: 0.95,
        frequencyPenalty: 0.5,
        presencePenalty: 0.3,
        seed: 42,
        topK: 50,
        minP: 0.1,
        repetitionPenalty: 1.2,
      });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.frequencyPenalty).toBe(0.5);
      expect(result.version.configData.llm.presencePenalty).toBe(0.3);
      expect(result.version.configData.llm.seed).toBe(42);
      expect(result.version.configData.llm.topK).toBe(50);
      expect(result.version.configData.llm.minP).toBe(0.1);
      expect(result.version.configData.llm.repetitionPenalty).toBe(1.2);
    });
  });

  describe("when reasoning effort is present", () => {
    it("populates the reasoning parameter", () => {
      const spanData = buildSpanData({ reasoning: "medium" });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.reasoning).toBe("medium");
    });
  });

  describe("when string-typed numeric parameters are provided", () => {
    it("coerces string frequency_penalty to number", () => {
      const spanData = buildSpanData({
        frequencyPenalty: "0.5" as unknown as number,
      });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.frequencyPenalty).toBe(0.5);
    });
  });

  describe("when unknown or garbage parameter values are provided", () => {
    it("leaves uncoercible parameters unset", () => {
      const spanData = buildSpanData({
        temperature: { value: 0.5 } as unknown as number,
        frequencyPenalty: true as unknown as number,
        seed: "not-a-number" as unknown as number,
      });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.temperature).toBeUndefined();
      expect(result.version.configData.llm.frequencyPenalty).toBeUndefined();
      expect(result.version.configData.llm.seed).toBeUndefined();
    });
  });

  describe("when only some parameters are specified", () => {
    it("populates only temperature and seed", () => {
      const spanData = buildSpanData({
        temperature: 0.5,
        seed: 123,
        maxTokens: null,
        topP: null,
        frequencyPenalty: null,
        presencePenalty: null,
        topK: null,
        minP: null,
        repetitionPenalty: null,
        reasoning: null,
        verbosity: null,
      });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.temperature).toBe(0.5);
      expect(result.version.configData.llm.seed).toBe(123);
      expect(result.version.configData.llm.maxTokens).toBeUndefined();
      expect(result.version.configData.llm.topP).toBeUndefined();
      expect(result.version.configData.llm.frequencyPenalty).toBeUndefined();
      expect(result.version.configData.llm.presencePenalty).toBeUndefined();
      expect(result.version.configData.llm.reasoning).toBeUndefined();
    });
  });
});
