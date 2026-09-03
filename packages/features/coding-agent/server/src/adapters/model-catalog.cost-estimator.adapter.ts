import {
  estimateModelCost,
  getStaticModelCostRates,
  type ModelCostEstimateInput,
} from "@langwatch/model-provider-contract";
import { CodingAgentCostEstimatorPort } from "../ports/coding-agent-cost-estimator.port";

/**
 * Session cost priced from the platform's immutable model catalog.
 *
 * Frozen twin of `ModelProviderCostsService.estimate`, which the App reaches
 * through `ModelProviderService.estimateCost`: the same pure function over the
 * same static rates, because that method already reads nothing else. Custom
 * per-tenant rates are not missing here — they travel on the span attributes
 * `estimateModelCost` reads (`custom_input_rate` and its siblings), so a
 * tenant that overrode a price is priced identically by both graphs.
 *
 * There is therefore no behaviour to diverge: what the App would compute for a
 * given set of token facts is what this computes.
 */
export class ModelCatalogCostEstimatorAdapter extends CodingAgentCostEstimatorPort {
  static create(): ModelCatalogCostEstimatorAdapter {
    return new ModelCatalogCostEstimatorAdapter();
  }

  private constructor() {
    super();
  }

  estimateCost(input: ModelCostEstimateInput): number {
    return estimateModelCost(input, getStaticModelCostRates());
  }
}
