import type { ModelCost } from "@langwatch/model-provider-contract";

/**
 * The project's own model-cost rules, as record-time cost enrichment reads them.
 *
 * This is deliberately NOT the shape the coding-agent cost estimator uses.
 * `CodingAgentCostEstimatorPort.estimateCost` is pure and synchronous over a
 * static catalog, and Trace already has the same thing in `TraceModelCostPort`
 * for fold-time cost. Neither can answer this question: an operator's
 * per-project, per-team and per-organization overrides live in a table, they
 * are matched by regex against the model name, and a span enriched from the
 * static catalog when an override exists is billed at the wrong rate with
 * nothing to show that it happened. So the precedent does not transfer, and
 * this port states the read it really is.
 *
 * `ModelProviderService` satisfies it structurally; nothing narrower exists
 * upstream, which is the reason for declaring it here rather than importing the
 * fourteen-method service.
 */
export abstract class TraceModelCostCatalogPort {
  abstract listCosts(input: { projectId: string }): Promise<ModelCost[]>;
}
