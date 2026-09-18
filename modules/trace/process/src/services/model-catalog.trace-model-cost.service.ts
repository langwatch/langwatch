import type { NormalizedAttributes } from "@langwatch/trace-contract";

import { type TraceModelCost } from "../app/trace.members.ts";
import { TraceSpanCostMatchingService } from "./trace-span-cost-matching.service.ts";

/**
 * Fold-time span cost from the model catalog, same as legacy paths. Custom rates ride on the span.
 */
export class ModelCatalogTraceModelCostAdapter implements TraceModelCost {
  static create(): ModelCatalogTraceModelCostAdapter {
    return new ModelCatalogTraceModelCostAdapter();
  }

  private constructor() {}

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
