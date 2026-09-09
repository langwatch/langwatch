import type { ModelCostEstimateInput } from "@langwatch/model-provider-contract";

/**
 * What a coding-agent session's cost is priced from.
 *
 * The fold used to take the whole `ModelProviderService` — every provider row,
 * every default, every credential and the authorization service behind them —
 * to call this one method, and that method reads nothing but the platform's
 * immutable static cost registry: `estimateModelCost(input, staticCostRates())`
 * with no query, no tenant and no I/O. A worker that folds sessions needs the
 * pricing, not the graph, and naming the method here is what lets it compose
 * the pipeline without also composing the App's provider stack.
 *
 * `ModelProviderService` satisfies it: the published service carries this
 * method with this signature, which is what keeps the frozen registration in
 * `platform/app` compiling.
 */
export abstract class CodingAgentCostEstimatorPort {
  /** Prices one model call from its token facts. */
  abstract estimateCost(input: ModelCostEstimateInput): number;
}
