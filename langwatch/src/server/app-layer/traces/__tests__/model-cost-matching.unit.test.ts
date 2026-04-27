import { describe, expect, it } from "vitest";
import { computeSpanCost } from "../model-cost-matching";

describe("computeSpanCost", () => {
  describe("when span has custom cost rates", () => {
    it("computes cost from custom rates", () => {
      const result = computeSpanCost({
        attrs: {
          "langwatch.model.inputCostPerToken": 0.000005,
          "langwatch.model.outputCostPerToken": 0.000015,
        },
        promptTokens: 100,
        completionTokens: 50,
      });
      // 100 * 0.000005 + 50 * 0.000015 = 0.00125
      expect(result).toBeCloseTo(0.00125, 6);
    });

    it("returns 0 without falling through when custom rates yield zero cost", () => {
      const result = computeSpanCost({
        attrs: {
          "langwatch.model.inputCostPerToken": 0,
          "langwatch.model.outputCostPerToken": 0,
          "gen_ai.request.model": "gpt-5-mini",
        },
        promptTokens: 1000,
        completionTokens: 500,
      });
      expect(result).toBe(0);
    });
  });

  describe("when span has model in static registry", () => {
    it("uses static registry pricing", () => {
      const result = computeSpanCost({
        attrs: { "gen_ai.request.model": "gpt-5-mini" },
        promptTokens: 1000,
        completionTokens: 500,
      });
      // gpt-5-mini: input=2.5e-7, output=2e-6
      // 1000 * 2.5e-7 + 500 * 2e-6 = 0.00125
      expect(result).toBeCloseTo(0.00125, 6);
    });
  });

  describe("when model has provider subtype and date suffix", () => {
    it("resolves cost via cascading fallback", () => {
      const result = computeSpanCost({
        attrs: { "gen_ai.request.model": "openai.responses/gpt-5-mini-2025-08-07" },
        promptTokens: 1000,
        completionTokens: 500,
      });
      // Should resolve to gpt-5-mini pricing after stripping
      expect(result).toBeCloseTo(0.00125, 6);
    });
  });

  describe("when model is passed as param", () => {
    it("uses the param over attributes", () => {
      const result = computeSpanCost({
        attrs: { "gen_ai.request.model": "totally-unknown-model" },
        model: "gpt-5-mini",
        promptTokens: 1000,
        completionTokens: 500,
      });
      expect(result).toBeCloseTo(0.00125, 6);
    });
  });

  describe("when response model and request model both present", () => {
    it("prefers response model over request model", () => {
      const result = computeSpanCost({
        attrs: {
          "gen_ai.response.model": "gpt-5-mini",
          "gen_ai.request.model": "totally-unknown-model",
        },
        promptTokens: 1000,
        completionTokens: 500,
      });
      expect(result).toBeCloseTo(0.00125, 6);
    });
  });

  describe("when span has SDK-provided cost", () => {
    it("falls back to SDK cost", () => {
      const result = computeSpanCost({
        attrs: { "langwatch.span.cost": 0.005 },
        promptTokens: null,
        completionTokens: null,
      });
      expect(result).toBeCloseTo(0.005, 6);
    });
  });

  describe("when span is a guardrail with USD cost", () => {
    it("extracts guardrail cost", () => {
      const result = computeSpanCost({
        attrs: {
          "langwatch.span.type": "guardrail",
          "langwatch.output": {
            passed: true,
            cost: { amount: 0.0042, currency: "USD" },
          },
        },
        promptTokens: null,
        completionTokens: null,
      });
      expect(result).toBeCloseTo(0.0042, 6);
    });

    it("ignores non-USD guardrail currency", () => {
      const result = computeSpanCost({
        attrs: {
          "langwatch.span.type": "guardrail",
          "langwatch.output": {
            passed: true,
            cost: { amount: 0.0042, currency: "EUR" },
          },
        },
        promptTokens: null,
        completionTokens: null,
      });
      expect(result).toBe(0);
    });
  });

  describe("when no cost information is available", () => {
    it("returns 0", () => {
      const result = computeSpanCost({
        attrs: {},
        promptTokens: null,
        completionTokens: null,
      });
      expect(result).toBe(0);
    });
  });
});
