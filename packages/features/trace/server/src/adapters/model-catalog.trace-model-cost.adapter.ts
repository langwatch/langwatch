import { TraceSpanCostMatchingService } from "../services/trace-span-cost-matching.service";
import type { NormalizedAttributes } from "@langwatch/trace-contract";
import { TraceModelCostPort } from "../ports/trace-model-cost.port";

/**
 * Fold-time span cost, priced from the platform's immutable model catalog — IS TraceSpanCostMatchingService.computeSpanCost, the same function the legacy span mapper and stored-span reader price through (no longer a frozen twin; one cascade over the STATIC catalog now). Per-project/team/org override rules are applied at RECORD time (getCustomLLMModelCosts -> OtlpSpanCostEnrichmentService), a separate, already-harvested pass — nothing on the fold path needs a database. A repriced tenant's own rates still ride on the span as custom_input_rate (+siblings), which estimateModelCost reads before the catalog, so both graphs price identically.
 */
export class ModelCatalogTraceModelCostAdapter extends TraceModelCostPort {
  static create(): ModelCatalogTraceModelCostAdapter {
    return new ModelCatalogTraceModelCostAdapter();
  }

  private constructor() {
    super();
  }

  estimate(input: {
    attributes: NormalizedAttributes;
    model: string | undefined;
    promptTokens: number | null;
    completionTokens: number | null;
  }): number {
    return TraceSpanCostMatchingService.computeSpanCost({
      attrs: input.attributes,
      ...(input.model === undefined ? {} : { model: input.model }),
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
    });
  }
}
