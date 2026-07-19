import { describe, expect, it } from "vitest";
import type { NormalizedSpan } from "../../../schemas/spans";
import { createTestSpan } from "../../__tests__/fixtures/trace-summary-test.fixtures";
import { deriveSpanCost } from "../span-cost.derivation";
import { SpanCostService } from "../span-cost.service";

/**
 * `deriveSpanCost` computes the per-span cost persisted on `stored_spans`.
 * These tests pin that it matches `SpanCostService.extractTokenMetrics().cost`
 * (the value the trace-summary fold accumulates) and that it splits the
 * non-billable portion the same way the fold derives `NonBilledCost`.
 */

const spanCostService = new SpanCostService();

function billedLlmSpan(
  overrides: Partial<NormalizedSpan["spanAttributes"]> = {},
): NormalizedSpan {
  return createTestSpan({
    spanAttributes: {
      "langwatch.span.type": "llm",
      "gen_ai.request.model": "gpt-5-mini",
      "gen_ai.response.model": "gpt-5-mini",
      "gen_ai.usage.input_tokens": 1000,
      "gen_ai.usage.output_tokens": 500,
      ...overrides,
    },
  });
}

describe("deriveSpanCost", () => {
  describe("given a billed LLM span with token usage", () => {
    it("returns the SpanCostService cost and no non-billed portion", () => {
      const span = billedLlmSpan();
      const expectedCost = spanCostService.extractTokenMetrics(span).cost;

      const { cost, nonBilledCost } = deriveSpanCost({
        span,
        spanCostService,
      });

      expect(expectedCost).toBeGreaterThan(0);
      expect(cost).toBeCloseTo(expectedCost, 6);
      expect(nonBilledCost).toBeNull();
    });
  });

  describe("given a non-billable span (flat-plan marker on the span)", () => {
    it("reports the whole cost as the non-billed portion", () => {
      const span = billedLlmSpan({
        "langwatch.cost.non_billable": true,
      });

      const { cost, nonBilledCost } = deriveSpanCost({
        span,
        spanCostService,
      });

      expect(cost).not.toBeNull();
      expect(cost).toBeGreaterThan(0);
      expect(nonBilledCost).toBe(cost);
    });
  });

  describe("given a non-billable marker inherited from the resource", () => {
    it("treats the span cost as bundled", () => {
      const span = createTestSpan({
        resourceAttributes: { "langwatch.cost.non_billable": "true" },
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.request.model": "gpt-5-mini",
          "gen_ai.response.model": "gpt-5-mini",
          "gen_ai.usage.input_tokens": 1000,
          "gen_ai.usage.output_tokens": 500,
        },
      });

      const { cost, nonBilledCost } = deriveSpanCost({
        span,
        spanCostService,
      });

      expect(cost).not.toBeNull();
      expect(nonBilledCost).toBe(cost);
    });
  });

  describe("given a span with no costable usage (no tokens, no cost)", () => {
    it("returns null for both cost and non-billed cost", () => {
      const span = createTestSpan({
        spanAttributes: { "langwatch.span.type": "span" },
      });

      expect(deriveSpanCost({ span, spanCostService })).toEqual({
        cost: null,
        nonBilledCost: null,
      });
    });
  });
});
