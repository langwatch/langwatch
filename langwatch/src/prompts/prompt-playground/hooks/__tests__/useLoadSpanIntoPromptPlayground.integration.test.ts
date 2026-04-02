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

describe("createDefaultPromptFormValues()", () => {
  describe("when trace data has string numbers for LLM config fields", () => {
    it("coerces string temperature to a number", () => {
      const spanData = buildSpanData({
        temperature: "0.7" as unknown as number,
      });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.temperature).toBe(0.7);
    });

    it("coerces string maxTokens to a number", () => {
      const spanData = buildSpanData({
        maxTokens: "1024" as unknown as number,
      });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.maxTokens).toBe(1024);
    });

    it("coerces string topP to a number", () => {
      const spanData = buildSpanData({
        topP: "0.9" as unknown as number,
      });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.topP).toBe(0.9);
    });
  });

  describe("when trace data has non-parseable values", () => {
    it("falls back to undefined for garbage temperature", () => {
      const spanData = buildSpanData({
        temperature: "not-a-number" as unknown as number,
      });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.temperature).toBeUndefined();
    });

    it("falls back to undefined for garbage maxTokens", () => {
      const spanData = buildSpanData({
        maxTokens: "garbage" as unknown as number,
      });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.maxTokens).toBeUndefined();
    });

    it("falls back to undefined for boolean temperature", () => {
      const spanData = buildSpanData({
        temperature: true as unknown as number,
      });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.temperature).toBeUndefined();
    });

    it("falls back to undefined for object temperature", () => {
      const spanData = buildSpanData({
        temperature: { value: 0.5 } as unknown as number,
      });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.temperature).toBeUndefined();
    });
  });

  describe("when trace data has all null/missing LLM config", () => {
    it("does not throw and returns valid form values", () => {
      const spanData = buildSpanData({
        model: null,
        temperature: null,
        maxTokens: null,
        topP: null,
      });

      expect(() => createDefaultPromptFormValues(spanData)).not.toThrow();

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.model).toBe(DEFAULT_MODEL);
      expect(result.version.configData.llm.temperature).toBeUndefined();
      expect(result.version.configData.llm.maxTokens).toBeUndefined();
    });
  });

  describe("when trace data has empty string model", () => {
    it("falls back to default model", () => {
      const spanData = buildSpanData({
        model: "" as string,
      });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.model).toBe(DEFAULT_MODEL);
    });
  });

  describe("when trace data has mixed valid and invalid fields", () => {
    it("coerces valid string numbers and drops invalid ones", () => {
      const spanData = buildSpanData({
        temperature: "0.3" as unknown as number,
        maxTokens: "invalid" as unknown as number,
        topP: "0.95" as unknown as number,
      });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.temperature).toBe(0.3);
      expect(result.version.configData.llm.maxTokens).toBeUndefined();
      expect(result.version.configData.llm.topP).toBe(0.95);
    });
  });

  describe("when trace data has all new numeric parameters as strings", () => {
    it("coerces all string-typed numeric parameters", () => {
      const spanData = buildSpanData({
        temperature: "0.7" as unknown as number,
        maxTokens: "2048" as unknown as number,
        frequencyPenalty: "0.5" as unknown as number,
        presencePenalty: "0.3" as unknown as number,
        seed: "42" as unknown as number,
        topK: "50" as unknown as number,
        minP: "0.1" as unknown as number,
        repetitionPenalty: "1.2" as unknown as number,
      });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.temperature).toBe(0.7);
      expect(result.version.configData.llm.maxTokens).toBe(2048);
      expect(result.version.configData.llm.frequencyPenalty).toBe(0.5);
      expect(result.version.configData.llm.presencePenalty).toBe(0.3);
      expect(result.version.configData.llm.seed).toBe(42);
      expect(result.version.configData.llm.topK).toBe(50);
      expect(result.version.configData.llm.minP).toBe(0.1);
      expect(result.version.configData.llm.repetitionPenalty).toBe(1.2);
    });
  });

  describe("when trace data has all null/missing LLM config including new params", () => {
    it("does not throw and returns valid form values with all params unset", () => {
      const spanData = buildSpanData({
        model: null,
        temperature: null,
        maxTokens: null,
        topP: null,
        frequencyPenalty: null,
        presencePenalty: null,
        seed: null,
        topK: null,
        minP: null,
        repetitionPenalty: null,
        reasoning: null,
        verbosity: null,
      });

      expect(() => createDefaultPromptFormValues(spanData)).not.toThrow();

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.model).toBe(DEFAULT_MODEL);
      expect(result.version.configData.llm.frequencyPenalty).toBeUndefined();
      expect(result.version.configData.llm.presencePenalty).toBeUndefined();
      expect(result.version.configData.llm.seed).toBeUndefined();
      expect(result.version.configData.llm.topK).toBeUndefined();
      expect(result.version.configData.llm.minP).toBeUndefined();
      expect(result.version.configData.llm.repetitionPenalty).toBeUndefined();
      expect(result.version.configData.llm.reasoning).toBeUndefined();
      expect(result.version.configData.llm.verbosity).toBeUndefined();
    });
  });

  describe("when trace data has reasoning and verbosity strings", () => {
    it("preserves reasoning and verbosity values", () => {
      const spanData = buildSpanData({
        reasoning: "high",
        verbosity: "verbose",
      });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.reasoning).toBe("high");
      expect(result.version.configData.llm.verbosity).toBe("verbose");
    });
  });
});
