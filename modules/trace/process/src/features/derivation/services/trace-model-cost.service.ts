import type { SpanPriceInput } from "@langwatch/trace-contract";

import {
  computeSpanCost,
  isSpanCostUnpriced,
} from "../../span/rules/trace-span-cost-matching.rules.ts";

export interface TraceModelCost {
  estimate(input: SpanPriceInput): number;
  /** Whether no price rule covers the span's usage: its zero cost is unknown, not free. */
  isUnpriced(input: SpanPriceInput): boolean;
}

/**
 * Fold-time span cost from the model catalog, same as legacy paths. Custom rates ride on the span.
 */
export class TraceModelCostService implements TraceModelCost {
  static create(): TraceModelCostService {
    return new TraceModelCostService();
  }

  private constructor() {}

  estimate(input: SpanPriceInput): number {
    return computeSpanCost(TraceModelCostService.cascadeInput(input));
  }

  isUnpriced(input: SpanPriceInput): boolean {
    return isSpanCostUnpriced(TraceModelCostService.cascadeInput(input));
  }

  private static cascadeInput(input: SpanPriceInput): Parameters<typeof computeSpanCost>[0] {
    return {
      attrs: input.attributes,
      ...(input.model === undefined ? {} : { model: input.model }),
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
    };
  }
}
