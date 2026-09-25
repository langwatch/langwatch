import { HandledError } from "@langwatch/handled-error";
import { modelCostListInputSchema, type ModelCost } from "@langwatch/model-provider-contract";

import type { ModelCostProjectScope } from "../app/model-provider.members.ts";
import type { ModelCostRepository } from "../repositories/model-cost.repository.ts";

/**
 * Lists a project's stored cost rules without the full `ModelProviderApi` graph (auth, credential
 * codec, etc.) that writing a cost needs — span pricing only reads. Returns empty rather than
 * throwing on an unreadable project, so an archived project falls back to the static catalog.
 */
export class ModelCostCatalogService {
  private constructor(
    private readonly costs: ModelCostRepository,
    private readonly scopes: ModelCostProjectScope,
  ) {}

  static create(options: {
    costs: ModelCostRepository;
    scopes: ModelCostProjectScope;
  }): ModelCostCatalogService {
    return new ModelCostCatalogService(options.costs, options.scopes);
  }

  async listCosts(input: { projectId: string }): Promise<ModelCost[]> {
    const projectId = modelCostListInputSchema.parse(input).projectId;
    return this.scopes
      .getProjectScopes(projectId)
      .then((projectScopes) => this.costs.findForProject(projectScopes))
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "project_not_found") return [];
        throw error;
      });
  }
}
