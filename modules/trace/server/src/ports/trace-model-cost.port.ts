import type { NormalizedAttributes } from "@langwatch/trace-contract";

export abstract class TraceModelCostPort {
  abstract estimate(input: {
    attributes: NormalizedAttributes;
    model: string | undefined;
    promptTokens: number | null;
    completionTokens: number | null;
  }): number;
}
