import type { ModelCost, ModelDefaultScope } from "@langwatch/model-provider-contract";

/** The custom cost rule as it is stored: the contract's own shape, whole. */
export type ModelCostRecord = ModelCost;

/**
 * A project's own model cost rules, read most specific scope first: the matcher
 * takes the first row whose pattern matches, so a project row has to precede an
 * organization row naming the same model whichever was saved last.
 */
export interface ModelCostRepository {
  listForProject(projectScopes: ModelDefaultScope[]): Promise<ModelCost[]>;
  tryFindById(id: string): Promise<ModelCost | null>;
  save(input: ModelCostRecord): Promise<ModelCost>;
  delete(id: string): Promise<void>;
}
