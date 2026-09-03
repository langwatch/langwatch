/**
 * A stored cost rule as the settings table reads it.
 *
 * The stored row spells "this rule sets no rate" as `null`, and the same for a
 * rule anchored above a single project. A table cell wants "absent" instead —
 * `null` renders as text. Converting once here keeps that translation out of
 * the cells that would otherwise each do it.
 *
 * A family-local copy of `platform/app/src/components/settings/llmModelCostRow.ts`,
 * which keeps one non-family caller there: `LLMModelCostDrawer`, the registered
 * drawer this move does not take (the unmapped-cost suggestion in a trace opens
 * it too). The platform copy dies with that drawer.
 */

import type { ModelCost } from "@langwatch/model-provider-contract";

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
