import type { NormalizedAttributes } from "@langwatch/trace-contract";

import { type TraceModelCost } from "../app/trace.members.ts";
import { computeSpanCost } from "../rules/trace-span-cost-matching.rules.ts";

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
