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

vi.mock("~/server/tracer/collector/cost", async () => {
  const actual = await vi.importActual<
    typeof import("~/server/tracer/collector/cost")
  >("~/server/tracer/collector/cost");
  return {
    // Keep the real estimateCost (pure arithmetic) and stub only the
    // DB-backed model-cost lookup.
    estimateCost: actual.estimateCost,
    matchModelCostWithFallbacks: actual.matchModelCostWithFallbacks,
    getMatchingLLMModelCost,
  };
});

import { getStaticModelCosts } from "~/server/modelProviders/llmModelCost";
import { matchModelCostWithFallbacks } from "~/server/tracer/collector/cost";
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

/**
 * The upstream catalog prices a model router at -1 per token, since a router
 * has no rate of its own. Every router in the catalog is listed here by id.
 */
const ROUTERS = [
  "openrouter/auto",
  "openrouter/auto-beta",
  "openrouter/fusion",
  "openrouter/pareto-code",
  "openrouter/bodybuilder",
  "nvidia/switchyard",
  "typesafe/jev-router",
];

describe("priceMetrics for a variable-price router", () => {
  beforeEach(() => {
    // The lookup reads the real static registry, which is where a router's
    // catalog rate would come from; only the database half is left out.
    getMatchingLLMModelCost.mockReset();
    getMatchingLLMModelCost.mockImplementation(
      async (_projectId: string, model: string) =>
        matchModelCostWithFallbacks(model, getStaticModelCosts()),
    );
  });

  describe("given an evaluation cell that ran a router", () => {
    /** @scenario An evaluation cell run on a router is never costed below zero */
    it.each(ROUTERS)("never costs %s below zero", async (model) => {
      const cost = await priceMetrics("project-1", {
        model,
        prompt_tokens: 1000,
        completion_tokens: 500,
      });
      expect(cost ?? 0).toBeGreaterThanOrEqual(0);
    });
  });
});
