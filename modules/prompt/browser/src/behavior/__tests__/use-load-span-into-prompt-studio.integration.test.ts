import type { PromptStudioSpanResult } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { DEFAULT_MODEL } from "../../model/prompt-constants.ts";
import {
  coerceToNumber,
  createDefaultPromptFormValues,
} from "../use-load-span-into-prompt-studio.ts";

type SpanData = PromptStudioSpanResult;

function buildSpanData(overrides: Partial<SpanData["llmConfig"]> = {}): SpanData {
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
    promptTag: null,
  };
}

describe("createDefaultPromptFormValues()", () => {
  describe("when a traced LLM parameter arrives as text", () => {
    it.each([
      ["0.7", 0.7],
      ["1024", 1024],
      ["0.9", 0.9],
    ])("coerces %j to a number", (raw, expected) => {
      expect(coerceToNumber(raw)).toBe(expected);
    });
  });

  describe("when a traced LLM parameter is not parseable", () => {
    it.each([["not-a-number"], ["garbage"], [true], [{ value: 0.5 }]])(
      "falls back to undefined for %j",
      (raw) => {
        expect(coerceToNumber(raw)).toBeUndefined();
      },
    );
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
        model: "",
      });

      const result = createDefaultPromptFormValues(spanData);

      expect(result.version.configData.llm.model).toBe(DEFAULT_MODEL);
    });
  });

  describe("when trace data carries every numeric parameter", () => {
    it("maps each one onto the form", () => {
      const spanData = buildSpanData({
        temperature: 0.7,
        maxTokens: 2048,
        frequencyPenalty: 0.5,
        presencePenalty: 0.3,
        seed: 42,
        topK: 50,
        minP: 0.1,
        repetitionPenalty: 1.2,
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
