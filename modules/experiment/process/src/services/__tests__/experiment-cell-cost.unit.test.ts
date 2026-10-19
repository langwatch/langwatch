/** @see modules/experiment/specs/experiment-cell-cost.feature */
import {
  estimateModelCost,
  type ModelCostRate,
  type ModelProviderApi,
} from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { ExperimentRunModelCostService } from "../../features/run/services/experiment-run-model-cost.service.ts";
import type { ExperimentRunCollaborators } from "../../rules/experiment-run-input.rules.ts";
import { ExperimentCellExecutionService } from "../experiment-cell-execution.service.ts";

const MODEL = "openai/cache-test-model";
const RATE: ModelCostRate = {
  model: MODEL,
  regex: "^openai/cache-test-model$",
  inputCostPerToken: 0.000001,
  outputCostPerToken: 0.000002,
  cacheReadCostPerToken: 0.0000001,
  cacheCreationCostPerToken: 0.00000125,
};

function pricing() {
  return ExperimentRunModelCostService.create({
    modelProviders: createApiFixture<Pick<ModelProviderApi, "estimateCost" | "listCosts">>({
      estimateCost: (input) => estimateModelCost(input, [RATE]),
      listCosts: async () => [],
    }),
  });
}

const NO_CACHE = { cacheReadTokens: 0, cacheCreationTokens: 0 };

describe("ExperimentRunModelCostService.findTokenPrice with cached tokens", () => {
  describe("when 9000 of 10000 prompt tokens were cached", () => {
    /** @scenario "Cached prompt tokens are priced at the cache-read rate" */
    it("costs less than a cell with no cached tokens", async () => {
      const base = { projectId: "project_1", model: MODEL, inputTokens: 10000, outputTokens: 0 };
      const cached = await pricing().findTokenPrice({
        ...base,
        cacheReadTokens: 9000,
        cacheCreationTokens: 0,
      });
      const uncached = await pricing().findTokenPrice({ ...base, ...NO_CACHE });

      expect(cached).toBeLessThan(uncached ?? 0);
    });
  });

  describe("when a prompt has cache reads and cache writes", () => {
    /** @scenario "Cached tokens are not priced twice" */
    it("prices fresh input, cache reads and cache writes once each", async () => {
      const price = await pricing().findTokenPrice({
        projectId: "project_1",
        model: MODEL,
        inputTokens: 10000,
        outputTokens: 0,
        cacheReadTokens: 8000,
        cacheCreationTokens: 1000,
      });

      const expected = 1000 * 0.000001 + 8000 * 0.0000001 + 1000 * 0.00000125;
      expect(price).toBeCloseTo(expected, 12);
    });
  });
});

describe("ExperimentCellExecutionService.findPriceMetrics", () => {
  function priceLookups() {
    const lookups: Parameters<ExperimentRunCollaborators["cost"]["findTokenPrice"]>[0][] = [];
    const service = ExperimentCellExecutionService.create({
      ports: createApiFixture<ExperimentRunCollaborators>(
        {
          cost: {
            findTokenPrice: async (input) => {
              lookups.push(input);
              return 0.5;
            },
          },
        },
        "ports",
      ),
      workflows: createApiFixture<WorkflowApi>({}),
    });
    return { service, lookups };
  }

  /** @scenario "A cell with only cached tokens is still priced" */
  it("looks up a price for a cell that reported only cached tokens", async () => {
    const { service, lookups } = priceLookups();

    const price = await service.findPriceMetrics({
      projectId: "project_1",
      metrics: { model: MODEL, cache_read_input_tokens: 500 },
    });

    expect(price).toBe(0.5);
    expect(lookups[0]).toMatchObject({
      inputTokens: 0,
      cacheReadTokens: 500,
      cacheCreationTokens: 0,
    });
  });

  /** @scenario "A cell with no tokens of any kind is left unpriced" */
  it("looks up no price when every count is zero", async () => {
    const { service, lookups } = priceLookups();

    const price = await service.findPriceMetrics({
      projectId: "project_1",
      metrics: { model: MODEL, prompt_tokens: 0, completion_tokens: 0, cache_read_input_tokens: 0 },
    });

    expect(price).toBeUndefined();
    expect(lookups).toEqual([]);
  });
});
