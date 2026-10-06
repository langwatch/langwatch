import type { NormalizedAttributes } from "@langwatch/trace-contract";

import { computeSpanCost } from "../rules/trace-span-cost-matching.rules.ts";

export interface TraceModelCost {
  estimate(input: {
    attributes: NormalizedAttributes;
    model: string | undefined;
    promptTokens: number | null;
    completionTokens: number | null;
  }): number;
}

/**
 * Fold-time span cost from the model catalog, same as legacy paths. Custom rates ride on the span.
 */
export class TraceModelCostService implements TraceModelCost {
  static create(): TraceModelCostService {
    return new TraceModelCostService();
  }

  private constructor() {}

  estimate(input: {
    attributes: NormalizedAttributes;
    model: string | undefined;
    promptTokens: number | null;
    completionTokens: number | null;
  }): number {
    return computeSpanCost({
      attrs: input.attributes,
      ...(input.model === undefined ? {} : { model: input.model }),
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
    });
  }
}
