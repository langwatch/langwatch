import {
  estimateModelCost,
  getStaticModelCostRates,
  type ModelCostEstimateInput,
} from "@langwatch/model-provider-contract";

import type { CodingAgentCostEstimator } from "../app/coding-agent.members.ts";

/** Cost from static catalog; frozen twin of ModelProviderCostsService.estimate. */
export class ModelCatalogCostEstimatorService implements CodingAgentCostEstimator {
  static create(): ModelCatalogCostEstimatorService {
    return new ModelCatalogCostEstimatorService();
  }

  private constructor() {}

  estimateCost(input: ModelCostEstimateInput): number {
    return estimateModelCost(input, getStaticModelCostRates());
  }
}
