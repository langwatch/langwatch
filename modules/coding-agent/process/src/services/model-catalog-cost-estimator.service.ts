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
  /** Whether a rule prices the model: priced at zero counts, an unknown model does not. */
  isModelPriced(model: string): boolean;
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

  isModelPriced(model: string): boolean {
    // One token stands for the usage a priced call has; only the model's price is in question.
    const input = { attrs: {}, model, promptTokens: 1, completionTokens: 0 };
    return !isModelCostUnpriced({ input, staticCosts: getStaticModelCostRates() });
  }
}
