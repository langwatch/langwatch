/**
 * Unit tests for reasoning configuration
 */

import { describe, it, expect } from "vitest";

import {
  pickReasoningConfig,
  supportsReasoning,
  getAllowedReasoningValues,
  pickDefaultReasoningEffort,
} from "../reasoning-config.rules.ts";

describe("Reasoning Config", () => {
  describe("given OpenAI models", () => {
    it("GPT-5.2 supports none through xhigh", () => {
      const config = pickReasoningConfig("openai/gpt-5.2");
      expect(config).toBeDefined();
      expect(config?.allowedValues).toContain("none");
      expect(config?.allowedValues).toContain("low");
      expect(config?.allowedValues).toContain("medium");
      expect(config?.allowedValues).toContain("high");
      expect(config?.allowedValues).toContain("xhigh");
      expect(config?.defaultValue).toBe("none");
      expect(config?.canDisable).toBe(true);
    });

    it("GPT-5.2-pro only supports high", () => {
      const config = pickReasoningConfig("openai/gpt-5.2-pro");
      expect(config).toBeDefined();
      expect(config?.allowedValues).toEqual(["high"]);
      expect(config?.defaultValue).toBe("high");
      expect(config?.canDisable).toBe(false);
    });

    it("GPT-5.1 supports none through high (no xhigh)", () => {
      const config = pickReasoningConfig("openai/gpt-5.1");
      expect(config).toBeDefined();
      expect(config?.allowedValues).toContain("none");
      expect(config?.allowedValues).toContain("low");
      expect(config?.allowedValues).toContain("medium");
      expect(config?.allowedValues).toContain("high");
      expect(config?.allowedValues).not.toContain("xhigh");
      expect(config?.defaultValue).toBe("none");
    });

    it("o1 models support low through high", () => {
      const config = pickReasoningConfig("openai/o1-preview");
      expect(config).toBeDefined();
      expect(config?.allowedValues).toEqual(["low", "medium", "high"]);
      expect(config?.defaultValue).toBe("medium");
      expect(config?.canDisable).toBe(false);
    });

    it("o3 models support low through high", () => {
      const config = pickReasoningConfig("openai/o3-mini");
      expect(config).toBeDefined();
      expect(config?.allowedValues).toEqual(["low", "medium", "high"]);
    });

    it("GPT-4 models don't have reasoning config", () => {
      const config = pickReasoningConfig("openai/gpt-4o");
      expect(config).toBeUndefined();
    });
  });

  describe("given Anthropic models", () => {
    it("Claude Opus 4.5 supports low/medium/high", () => {
      const config = pickReasoningConfig("anthropic/claude-opus-4");
      expect(config).toBeDefined();
      expect(config?.allowedValues).toEqual(["low", "medium", "high"]);
      expect(config?.defaultValue).toBe("high");
      expect(config?.parameterName).toBe("effort");
    });

    it("Claude 3.5 doesn't have reasoning config", () => {
      const config = pickReasoningConfig("anthropic/claude-3.5-sonnet");
      expect(config).toBeUndefined();
    });
  });

  describe("given Gemini models", () => {
    it("Gemini 2.5 Flash supports none/low/high and can disable", () => {
      const config = pickReasoningConfig("gemini/gemini-2.5-flash");
      expect(config).toBeDefined();
      expect(config?.allowedValues).toContain("none");
      expect(config?.allowedValues).toContain("low");
      expect(config?.allowedValues).toContain("high");
      expect(config?.canDisable).toBe(true);
      expect(config?.parameterName).toBe("thinkingLevel");
    });

    it("Gemini 2.5 Pro only supports low/high (cannot disable)", () => {
      const config = pickReasoningConfig("gemini/gemini-2.5-pro");
      expect(config).toBeDefined();
      expect(config?.allowedValues).toEqual(["low", "high"]);
      expect(config?.canDisable).toBe(false);
    });

    it("Gemini 3 supports low/high", () => {
      const config = pickReasoningConfig("gemini/gemini-3-flash-preview");
      expect(config).toBeDefined();
      expect(config?.allowedValues).toEqual(["low", "high"]);
    });
  });

  describe("given xAI models", () => {
    it("Grok-3-mini supports low/high", () => {
      const config = pickReasoningConfig("xai/grok-3-mini");
      expect(config).toBeDefined();
      expect(config?.allowedValues).toEqual(["low", "high"]);
    });

    it("Grok-3 (non-mini) doesn't have reasoning config", () => {
      const config = pickReasoningConfig("xai/grok-3");
      expect(config).toBeUndefined();
    });
  });

  describe("given DeepSeek models", () => {
    it("DeepSeek R1 supports reasoning", () => {
      const config = pickReasoningConfig("deepseek/deepseek-r1");
      expect(config).toBeDefined();
      expect(config?.allowedValues).toContain("low");
      expect(config?.allowedValues).toContain("medium");
      expect(config?.allowedValues).toContain("high");
    });

    it("DeepSeek chat doesn't have reasoning config", () => {
      const config = pickReasoningConfig("deepseek/deepseek-chat");
      expect(config).toBeUndefined();
    });
  });

  describe("given the helper functions", () => {
    it("supportsReasoning returns true for reasoning models", () => {
      expect(supportsReasoning("openai/gpt-5.2")).toBe(true);
      expect(supportsReasoning("gemini/gemini-2.5-flash")).toBe(true);
    });

    it("supportsReasoning returns false for non-reasoning models", () => {
      expect(supportsReasoning("openai/gpt-4o")).toBe(false);
      expect(supportsReasoning("anthropic/claude-3.5-sonnet")).toBe(false);
    });

    it("getAllowedReasoningValues returns values for reasoning models", () => {
      const values = getAllowedReasoningValues("openai/gpt-5.2");
      expect(values.length).toBeGreaterThan(0);
    });

    it("getAllowedReasoningValues returns empty array for non-reasoning models", () => {
      const values = getAllowedReasoningValues("openai/gpt-4o");
      expect(values).toEqual([]);
    });

    it("pickDefaultReasoningEffort returns default for reasoning models", () => {
      expect(pickDefaultReasoningEffort("openai/gpt-5.2")).toBe("none");
      expect(pickDefaultReasoningEffort("openai/gpt-5.2-pro")).toBe("high");
    });

    it("pickDefaultReasoningEffort returns undefined for non-reasoning models", () => {
      expect(pickDefaultReasoningEffort("openai/gpt-4o")).toBeUndefined();
    });
  });

  describe("given case-insensitive model IDs", () => {
    it("handles uppercase model IDs", () => {
      const config = pickReasoningConfig("OPENAI/GPT-5.2");
      expect(config).toBeDefined();
    });

    it("handles mixed case", () => {
      const config = pickReasoningConfig("OpenAI/GPT-5.2-Pro");
      expect(config).toBeDefined();
    });
  });
});
