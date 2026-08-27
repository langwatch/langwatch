import { describe, expect, it } from "vitest";
import { TraceCanonicalisationService } from "@langwatch/trace-server";
import type { NormalizedSpan } from "@langwatch/trace-contract";
import { createTestSpan } from "../../tests/fixtures/trace-summary-test.fixtures";
import { SpanCostService } from "@langwatch/trace-server";
import { computeSpanCost } from "~/server/app-layer/traces/model-cost-matching";

/**
 * `deriveSpanCost` computes the per-span cost persisted on `stored_spans`.
 * These tests pin that it matches `SpanCostService.extractTokenMetrics().cost`
 * (the value the trace-summary fold accumulates) and that it splits the
 * non-billable portion the same way the fold derives `NonBilledCost`.
 */

const spanCostService = SpanCostService.create({
  modelCosts: {
    estimate: ({ attributes, model, promptTokens, completionTokens }) =>
      computeSpanCost({
        attrs: attributes,
        model,
        promptTokens,
        completionTokens,
      }),
  },
});

function billedLlmSpan(overrides: Partial<NormalizedSpan["spanAttributes"]> = {}): NormalizedSpan {
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

describe("SpanCostService.deriveStorageCost", () => {
  describe("given a billed LLM span with token usage", () => {
    it("returns the SpanCostService cost and no non-billed portion", () => {
      const span = billedLlmSpan();
      const expectedCost = spanCostService.extractTokenMetrics(span).cost;

      const { cost, nonBilledCost } = spanCostService.deriveStorageCost(span);

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

      const { cost, nonBilledCost } = spanCostService.deriveStorageCost(span);

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

      const { cost, nonBilledCost } = spanCostService.deriveStorageCost(span);

      expect(cost).not.toBeNull();
      expect(nonBilledCost).toBe(cost);
    });
  });

  describe("given a span with no costable usage (no tokens, no cost)", () => {
    it("returns null for both cost and non-billed cost", () => {
      const span = createTestSpan({
        spanAttributes: { "langwatch.span.type": "span" },
      });

      expect(spanCostService.deriveStorageCost(span)).toEqual({
        cost: null,
        nonBilledCost: null,
      });
    });
  });

  describe("given a codex account-provider span", () => {
    // Builds the span through the real canonicalisation chain, so the test
    // exercises the CodexExtractor's non-billable stamp and the registry
    // lookup exactly as ingestion does.
    const canonicalizedCodexSpan = (wireAttributes: Record<string, unknown>): NormalizedSpan => {
      const base = createTestSpan({ name: "gen_ai.responses" });
      const { attributes } = TraceCanonicalisationService.create().canonicalizeSpanAttributes({
        spanAttributes: wireAttributes,
        events: [],
        span: {
          name: base.name,
          kind: base.kind,
          instrumentationScope: {
            name: "langwatch-service-aigateway",
            version: null,
          },
          statusMessage: base.statusMessage,
          statusCode: base.statusCode,
          parentSpanId: base.parentSpanId,
        },
      });
      return createTestSpan({
        name: base.name,
        spanAttributes: attributes,
      });
    };

    describe("when its per-span cost is derived", () => {
      /** @scenario A codex span's computed cost is classified as bundled */
      it("computes a positive cost from the underlying OpenAI pricing and reports it all as bundled", () => {
        // The gateway's wire shape: codex provider name, the bare underlying
        // model id, and a zero usage cost (the plan is billed, not tokens).
        const span = canonicalizedCodexSpan({
          "gen_ai.provider.name": "openai_codex",
          "gen_ai.operation.name": "responses",
          "gen_ai.request.model": "gpt-5.6-terra",
          "gen_ai.usage.input_tokens": 37749,
          "gen_ai.usage.output_tokens": 181,
          "gen_ai.usage.cost": 0,
          "langwatch.span.type": "llm",
        });

        const { cost, nonBilledCost } = spanCostService.deriveStorageCost(span);

        expect(cost).not.toBeNull();
        expect(cost).toBeGreaterThan(0);
        expect(nonBilledCost).toBe(cost);
      });

      it("prices a codex-prefixed model id from the same OpenAI entry and keeps it bundled", () => {
        const span = canonicalizedCodexSpan({
          "gen_ai.request.model": "openai_codex/gpt-5.6-terra",
          "gen_ai.usage.input_tokens": 1000,
          "gen_ai.usage.output_tokens": 500,
          "langwatch.span.type": "llm",
        });

        const { cost, nonBilledCost } = spanCostService.deriveStorageCost(span);

        expect(cost).not.toBeNull();
        expect(cost).toBeGreaterThan(0);
        expect(nonBilledCost).toBe(cost);
      });
    });
  });
});
