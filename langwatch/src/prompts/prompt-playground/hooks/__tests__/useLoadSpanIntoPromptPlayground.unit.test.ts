import { describe, it, expect } from "vitest";
import {
  createDefaultPromptFormValues,
  coerceToNumber,
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
      litellmParams: {},
      ...overrides,
    },
    vendor: "openai",
    error: null,
    timestamps: undefined,
    metrics: null,
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
});
