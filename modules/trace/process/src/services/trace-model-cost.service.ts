import type { NormalizedAttributes } from "@langwatch/trace-contract";

import { computeSpanCost, isSpanCostUnpriced } from "../rules/trace-span-cost-matching.rules.ts";

/** The span a cost question is asked about. */
export interface TraceModelCostInput {
  attributes: NormalizedAttributes;
  model: string | undefined;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface TraceModelCost {
  estimate(input: TraceModelCostInput): number;
  /** Whether no price rule covers the span's usage: its zero cost is unknown, not free. */
  isUnpriced(input: TraceModelCostInput): boolean;
}

/**
 * Fold-time span cost from the model catalog, same as legacy paths. Custom rates ride on the span.
 */
export class TraceModelCostService implements TraceModelCost {
  static create(): TraceModelCostService {
    return new TraceModelCostService();
  }

  private constructor() {}

  estimate(input: TraceModelCostInput): number {
    return computeSpanCost(TraceModelCostService.cascadeInput(input));
  }

  isUnpriced(input: TraceModelCostInput): boolean {
    return isSpanCostUnpriced(TraceModelCostService.cascadeInput(input));
  }

  private static cascadeInput(input: TraceModelCostInput): {
    attrs: NormalizedAttributes;
    model?: string;
    promptTokens: number | null;
    completionTokens: number | null;
  } {
    return {
      attrs: input.attributes,
      ...(input.model === undefined ? {} : { model: input.model }),
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
    };
  }
}
