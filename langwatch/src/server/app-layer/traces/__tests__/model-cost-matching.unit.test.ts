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

    it("prices cache tokens at the custom override rate when present", () => {
      const result = computeSpanCost({
        attrs: {
          "langwatch.model.inputCostPerToken": 0.000005,
          "langwatch.model.outputCostPerToken": 0.000015,
          "langwatch.model.cacheReadCostPerToken": 0.0000005,
          "langwatch.model.cacheCreationCostPerToken": 0.00000625,
          "gen_ai.usage.cache_read.input_tokens": 1000,
          "gen_ai.usage.cache_creation.input_tokens": 100,
        },
        promptTokens: 100,
        completionTokens: 50,
      });
      // 100*5e-6 + 50*15e-6 + 1000*5e-7 + 100*6.25e-6 = 0.00250
      expect(result).toBeCloseTo(
        100 * 0.000005 + 50 * 0.000015 + 1000 * 0.0000005 + 100 * 0.00000625,
        10,
      );
    });

    it("falls back to the input rate for cache tokens when no cache override is set", () => {
      const result = computeSpanCost({
        attrs: {
          "langwatch.model.inputCostPerToken": 0.000005,
          "langwatch.model.outputCostPerToken": 0.000015,
          "gen_ai.usage.cache_read.input_tokens": 1000,
        },
        promptTokens: 100,
        completionTokens: 0,
      });
      // No cache override: cache reads billed at the input rate.
      expect(result).toBeCloseTo(100 * 0.000005 + 1000 * 0.000005, 10);
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

  describe("when span has prompt-cache tokens", () => {
    it("prices cache-read tokens at the discounted cache rate, not the full input price", () => {
      // A mostly-cached follow-up: 510 fresh input + 37127 cache-read + 14
      // cache-write (the depleted-"yo" shape from the bug report).
      const cacheAware = computeSpanCost({
        attrs: {
          "gen_ai.request.model": "claude-opus-4-7",
          "gen_ai.usage.cache_read.input_tokens": 37127,
          "gen_ai.usage.cache_creation.input_tokens": 14,
        },
        promptTokens: 510,
        completionTokens: 12,
      });
      // The bug: the 37k cache-read tokens billed as full input price.
      const asIfFullInput = computeSpanCost({
        attrs: { "gen_ai.request.model": "claude-opus-4-7" },
        promptTokens: 510 + 37127 + 14,
        completionTokens: 12,
      });
      expect(cacheAware).toBeGreaterThan(0);
      expect(cacheAware!).toBeLessThan(asIfFullInput!);
    });

    it("adds cache-read cost on top of the non-cached input (input treated as exclusive)", () => {
      const cost = computeSpanCost({
        attrs: {
          "gen_ai.request.model": "claude-opus-4-7",
          "gen_ai.usage.cache_read.input_tokens": 1000,
        },
        promptTokens: 100,
        completionTokens: 0,
      })!;
      // claude-opus-4-7: input 5e-6/token, cache-read 5e-7/token.
      expect(cost).toBeCloseTo(100 * 5e-6 + 1000 * 5e-7, 10);
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
        attrs: {
          "gen_ai.request.model": "openai.responses/gpt-5-mini-2025-08-07",
        },
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
    it("uses the SDK cost when no model/tokens are present", () => {
      const result = computeSpanCost({
        attrs: { "langwatch.span.cost": 0.005 },
        promptTokens: null,
        completionTokens: null,
      });
      expect(result).toBeCloseTo(0.005, 6);
    });

    it("prefers the explicit cost over the registry for a known model with tokens", () => {
      // Regression: a known model + tokens used to win via the registry,
      // silently dropping an explicit negotiated/override cost. The explicit
      // figure is authoritative and must win.
      const result = computeSpanCost({
        attrs: {
          "gen_ai.request.model": "gpt-5-mini",
          "langwatch.span.cost": 0.042,
        },
        promptTokens: 1000,
        completionTokens: 500,
      });
      // Registry would compute 0.00125; the explicit cost wins.
      expect(result).toBeCloseTo(0.042, 6);
    });

    it("prefers a provider-reported cost over the registry for an on-table model (Claude Code cost_usd)", () => {
      // Anthropic reports its own cost_usd on every claude turn; for on-table
      // models it must win over our token×registry estimate.
      const result = computeSpanCost({
        attrs: {
          "gen_ai.response.model": "claude-opus-4-7",
          "langwatch.span.cost": 0.123,
        },
        promptTokens: 2000,
        completionTokens: 800,
      });
      expect(result).toBeCloseTo(0.123, 6);
    });

    it("falls through to the registry when the explicit cost is zero", () => {
      // A zero (or absent) explicit cost must not suppress registry costing.
      const result = computeSpanCost({
        attrs: {
          "gen_ai.request.model": "gpt-5-mini",
          "langwatch.span.cost": 0,
        },
        promptTokens: 1000,
        completionTokens: 500,
      });
      expect(result).toBeCloseTo(0.00125, 6);
    });

    it("keeps per-token enrichment rates ahead of an explicit total cost", () => {
      // Custom per-token rates are a deliberate pricing policy and stay first.
      const result = computeSpanCost({
        attrs: {
          "gen_ai.request.model": "gpt-5-mini",
          "langwatch.model.inputCostPerToken": 1e-6,
          "langwatch.model.outputCostPerToken": 2e-6,
          "langwatch.span.cost": 0.042,
        },
        promptTokens: 1000,
        completionTokens: 500,
      });
      // 1000 * 1e-6 + 500 * 2e-6 = 0.002 (enrichment), not 0.042 (explicit).
      expect(result).toBeCloseTo(0.002, 6);
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
