import {
  estimateModelCost,
  getStaticModelCostRates,
  isModelCostUnpriced,
  type ModelCostEstimateInput,
} from "@langwatch/model-provider-contract";

/** Static cost pricing for sessions; reduces dependencies in the worker. */
export interface CodingAgentCostEstimator {
  /** Prices one model call from its token facts. */
  estimateCost(input: ModelCostEstimateInput): number;
  /** Whether a rule prices the call's model: priced at zero counts, an unknown model does not. */
  isPriced(input: ModelCostEstimateInput): boolean;
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

  isPriced(input: ModelCostEstimateInput): boolean {
    return !isModelCostUnpriced({ input, staticCosts: getStaticModelCostRates() });
  }
}
