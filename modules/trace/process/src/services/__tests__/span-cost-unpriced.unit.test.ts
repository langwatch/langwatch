/**
 * The fold counts spans whose usage no price rule covers, and keeps their models.
 * @see modules/trace/specs/trace-unpriced-cost.feature
 */
import type { NormalizedSpan, TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  createInitState,
  createTestSpan,
} from "../../eventing/__tests__/trace-summary-test.fixtures.ts";
import { SpanCostService } from "../span-cost.service.ts";
import { TraceModelCostService } from "../trace-model-cost.service.ts";

const service = SpanCostService.create({ modelCosts: TraceModelCostService.create() });

function llmSpan({
  model,
  attributes = {},
}: {
  model: string;
  attributes?: Record<string, unknown>;
}): NormalizedSpan {
  return createTestSpan({
    spanId: `span-${model}`,
    name: "llm",
    spanAttributes: {
      "gen_ai.request.model": model,
      "gen_ai.usage.input_tokens": 1000,
      "gen_ai.usage.output_tokens": 200,
      ...attributes,
    },
  });
}

function fold({ spans }: { spans: readonly NormalizedSpan[] }): TraceSummaryData {
  return spans.reduce<TraceSummaryData>(
    (state, span) => ({
      ...state,
      ...service.accumulateTokens({ state, span, totalDurationMs: 1000 }),
    }),
    createInitState(),
  );
}

describe("SpanCostService unpriced spans", () => {
  describe("given a span for a model the catalogue does not know", () => {
    /** @scenario "A span whose model has no price is counted as unpriced" */
    it("counts the span and lists its model", () => {
      const state = fold({ spans: [llmSpan({ model: "my-finetune-v2" })] });

      expect(state.unpricedSpanCount).toBe(1);
      expect(state.unpricedModels).toEqual(["my-finetune-v2"]);
      expect(state.totalCost).toBeNull();
    });
  });

  describe("given a span for a catalogue model", () => {
    /** @scenario "A priced span is not counted" */
    it("counts nothing", () => {
      const state = fold({ spans: [llmSpan({ model: "gpt-5-mini" })] });

      expect(state.unpricedSpanCount).toBe(0);
      expect(state.unpricedModels).toEqual([]);
    });
  });

  describe("given custom rates of zero", () => {
    /** @scenario "A model priced at zero on purpose is not unpriced" */
    it("treats the model as free, not unpriced", () => {
      const state = fold({
        spans: [
          llmSpan({
            model: "my-finetune-v2",
            attributes: {
              "langwatch.model.inputCostPerToken": 0,
              "langwatch.model.outputCostPerToken": 0,
            },
          }),
        ],
      });

      expect(state.unpricedSpanCount).toBe(0);
    });
  });

  describe("given a span that reports no tokens", () => {
    /** @scenario "A span with no usage is not unpriced" */
    it("counts nothing", () => {
      const span = createTestSpan({
        spanAttributes: { "gen_ai.request.model": "my-finetune-v2" },
      });

      expect(fold({ spans: [span] }).unpricedSpanCount).toBe(0);
    });
  });

  describe("given a span marked to skip token accumulation", () => {
    /** @scenario "A redundant usage copy is not counted twice" */
    it("counts nothing", () => {
      const span = llmSpan({
        model: "my-finetune-v2",
        attributes: { "langwatch.reserved.skip_token_accumulation": true },
      });

      expect(fold({ spans: [span] }).unpricedSpanCount).toBe(0);
    });
  });

  describe("given several unpriced spans sharing a model", () => {
    /** @scenario "Unpriced models are kept once each, sorted" */
    it("counts every span and lists each model once, sorted", () => {
      const state = fold({
        spans: [
          llmSpan({ model: "zeta-model" }),
          llmSpan({ model: "alpha-model" }),
          llmSpan({ model: "zeta-model" }),
        ],
      });

      expect(state.unpricedSpanCount).toBe(3);
      expect(state.unpricedModels).toEqual(["alpha-model", "zeta-model"]);
    });
  });

  describe("given a state folded before unpriced spans were recorded", () => {
    it("starts counting from the span that arrives now", () => {
      const { unpricedSpanCount: _count, unpricedModels: _models, ...older } = createInitState();

      const next = service.accumulateTokens({
        state: older,
        span: llmSpan({ model: "my-finetune-v2" }),
        totalDurationMs: 1000,
      });

      expect(next.unpricedSpanCount).toBe(1);
      expect(next.unpricedModels).toEqual(["my-finetune-v2"]);
    });
  });
});
