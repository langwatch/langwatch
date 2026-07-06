/**
 * The engine surfaces an LLM node's token usage + model but no cost (it has no
 * price table). priceMetrics derives the cost at the project's canonical model
 * rate, the same path the trace-ingest collector uses, so an evaluations-v3
 * cell's cost matches its trace's cost.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMatchingLLMModelCost } = vi.hoisted(() => ({
  getMatchingLLMModelCost: vi.fn(),
}));

vi.mock("~/server/background/workers/collector/cost", async () => {
  const actual = await vi.importActual<
    typeof import("~/server/background/workers/collector/cost")
  >("~/server/background/workers/collector/cost");
  return {
    // Keep the real estimateCost (pure arithmetic) and stub only the
    // DB-backed model-cost lookup.
    estimateCost: actual.estimateCost,
    getMatchingLLMModelCost,
  };
});

import { priceMetrics } from "../orchestrator";

const MODEL_COST = {
  model: "openai/gpt-5-mini",
  inputCostPerToken: 5e-8,
  outputCostPerToken: 4e-7,
};

describe("priceMetrics", () => {
  beforeEach(() => {
    getMatchingLLMModelCost.mockReset();
  });

  describe("given a model and token usage", () => {
    it("prices the tokens at the model rate", async () => {
      getMatchingLLMModelCost.mockResolvedValueOnce(MODEL_COST);

      const cost = await priceMetrics("project-1", {
        model: "openai/gpt-5-mini",
        prompt_tokens: 1000,
        completion_tokens: 500,
      });

      // 1000 * 5e-8 + 500 * 4e-7 = 0.00005 + 0.0002 = 0.00025
      expect(cost).toBeCloseTo(0.00025, 10);
      expect(getMatchingLLMModelCost).toHaveBeenCalledWith(
        "project-1",
        "openai/gpt-5-mini",
      );
    });
  });

  describe("given no model", () => {
    it("returns undefined without a cost lookup", async () => {
      const cost = await priceMetrics("project-1", {
        prompt_tokens: 1000,
        completion_tokens: 500,
      });
      expect(cost).toBeUndefined();
      expect(getMatchingLLMModelCost).not.toHaveBeenCalled();
    });
  });

  describe("given a model but zero tokens", () => {
    it("returns undefined without a cost lookup", async () => {
      const cost = await priceMetrics("project-1", {
        model: "openai/gpt-5-mini",
        prompt_tokens: 0,
        completion_tokens: 0,
      });
      expect(cost).toBeUndefined();
      expect(getMatchingLLMModelCost).not.toHaveBeenCalled();
    });
  });

  describe("when the model has no known rate", () => {
    it("returns undefined", async () => {
      getMatchingLLMModelCost.mockResolvedValueOnce(undefined);

      const cost = await priceMetrics("project-1", {
        model: "openai/some-unknown-model",
        prompt_tokens: 100,
        completion_tokens: 50,
      });
      expect(cost).toBeUndefined();
    });
  });
});
