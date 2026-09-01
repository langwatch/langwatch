import type { ModelCost } from "@langwatch/model-provider-contract";

/**
 * A stored cost rule as the settings surfaces read it.
 *
 * The stored row spells "this rule sets no rate" as `null`, and the same for a
 * rule anchored above a single project. A table cell and a form field both
 * want "absent" instead — `null` renders as text and react-hook-form treats it
 * as a value the user chose. Converting once here keeps that translation out
 * of the six places that would otherwise each do it.
 */
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
