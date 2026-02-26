import { describe, it, expect } from "vitest";
import { createDefaultPromptFormValues } from "../useLoadSpanIntoPromptPlayground";
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
