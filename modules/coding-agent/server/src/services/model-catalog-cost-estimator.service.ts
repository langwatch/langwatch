import {
  estimateModelCost,
  getStaticModelCostRates,
  type ModelCostEstimateInput,
} from "@langwatch/model-provider-contract";
import type { CodingAgentCostEstimator } from "../app/coding-agent.members.ts";

/** Cost from static catalog; frozen twin of ModelProviderCostsService.estimate. */
export class ModelCatalogCostEstimatorAdapter implements CodingAgentCostEstimator {
  static create(): ModelCatalogCostEstimatorAdapter {
    return new ModelCatalogCostEstimatorAdapter();
  }

  private constructor() {
  }

  estimateCost(input: ModelCostEstimateInput): number {
    return estimateModelCost(input, getStaticModelCostRates());
  }
}
