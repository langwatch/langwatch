import {
  estimateModelCost,
  getStaticModelCostRates,
  type ModelCostEstimateInput,
} from "@langwatch/model-provider-contract";

/** Static cost pricing for sessions; reduces dependencies in the worker. */
export interface CodingAgentCostEstimator {
  /** Prices one model call from its token facts. */
  estimateCost(input: ModelCostEstimateInput): number;
}

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
