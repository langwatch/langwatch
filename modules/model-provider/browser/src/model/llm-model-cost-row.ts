/**
 * A listed cost as the settings table and the cost drawer read it: a stored rule's `null` ("no
 * rate set") converts once here to "absent" for the cell, and a catalogue rate carries no id,
 * scope or timestamps, which is how the table tells it from a stored rule.
 */

import type { WireOf } from "@langwatch/api/web";
import type {
  ModelCost as StoredModelCost,
  ModelCostListRow,
} from "@langwatch/model-provider-contract";

/** A cost rule as the browser receives it: its instants are ISO strings. */
type ModelCost = WireOf<StoredModelCost>;
type ListedCost = WireOf<ModelCostListRow>;

export type LLMModelCostRow = Partial<
  Pick<ModelCost, "id" | "organizationId" | "scopeType" | "scopeId" | "createdAt" | "updatedAt">
> &
  Pick<ModelCost, "model" | "regex"> & {
    projectId?: string;
    inputCostPerToken?: number;
    outputCostPerToken?: number;
    cacheReadCostPerToken?: number;
    cacheCreationCostPerToken?: number;
    cacheCreation1hCostPerToken?: number;
    inputImageCostPerToken?: number;
    outputImageCostPerToken?: number;
  };

function absent(rate: number | null): number | undefined {
  return rate ?? undefined;
}

export function toLLMModelCostRow(cost: ListedCost): LLMModelCostRow {
  if (!("id" in cost)) {
    return {
      model: cost.model,
      regex: cost.regex,
      inputCostPerToken: cost.inputCostPerToken,
      outputCostPerToken: cost.outputCostPerToken,
      cacheReadCostPerToken: cost.cacheReadCostPerToken,
      cacheCreationCostPerToken: cost.cacheCreationCostPerToken,
      cacheCreation1hCostPerToken: cost.cacheCreation1hCostPerToken,
      inputImageCostPerToken: cost.inputImageCostPerToken,
      outputImageCostPerToken: cost.outputImageCostPerToken,
    };
  }

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
