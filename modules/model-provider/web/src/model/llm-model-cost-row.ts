/**
 * A stored cost rule as the settings table reads it. The stored row spells
 * "this rule sets no rate" as `null`, which a table cell wants as "absent"
 * instead — converting once here keeps that translation out of every cell.
 * A family-local copy; the old module survives for `LLMModelCostDrawer`.
 */

import type { ModelCost as StoredModelCost } from "@langwatch/model-provider-contract";
import type { WireOf } from "@langwatch/api/web";

/** A cost rule as the browser receives it: its instants are ISO strings. */
type ModelCost = WireOf<StoredModelCost>;

export type LLMModelCostRow = Omit<
  ModelCost,
  | "projectId"
  | "inputCostPerToken"
  | "outputCostPerToken"
  | "cacheReadCostPerToken"
  | "cacheCreationCostPerToken"
  | "cacheCreation1hCostPerToken"
> & {
  projectId?: string;
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  cacheReadCostPerToken?: number;
  cacheCreationCostPerToken?: number;
  cacheCreation1hCostPerToken?: number;
};

function absent(rate: number | null): number | undefined {
  return rate ?? undefined;
}

export function toLLMModelCostRow(cost: ModelCost): LLMModelCostRow {
  return {
    ...cost,
    projectId: cost.projectId ?? undefined,
    inputCostPerToken: absent(cost.inputCostPerToken),
    outputCostPerToken: absent(cost.outputCostPerToken),
    cacheReadCostPerToken: absent(cost.cacheReadCostPerToken),
    cacheCreationCostPerToken: absent(cost.cacheCreationCostPerToken),
    cacheCreation1hCostPerToken: absent(cost.cacheCreation1hCostPerToken),
  };
}
