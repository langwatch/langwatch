import { HandledError } from "@langwatch/handled-error";
import { modelProviderListProjectInputSchema } from "@langwatch/model-provider-contract";

import type { ModelCostProjectScope } from "../app/model-provider.members.ts";
import type { ModelProviderEvidenceRepository } from "../repositories/model-provider-evidence.repository.ts";

/**
 * Whether a project has a model provider attached and switched on — kept
 * separate from `ModelProviderApi`, checking the full PROJECT -> TEAM ->
 * ORGANIZATION cascade. Returns false, not a throw, on an unreadable project.
 */
export class ModelProviderEvidenceService {
  private constructor(
    private readonly providers: ModelProviderEvidenceRepository,
    private readonly scopes: ModelCostProjectScope,
  ) {}

  static create(options: {
    providers: ModelProviderEvidenceRepository;
    scopes: ModelCostProjectScope;
  }): ModelProviderEvidenceService {
    return new ModelProviderEvidenceService(options.providers, options.scopes);
  }

  async hasEnabledProvider(input: { projectId: string }): Promise<boolean> {
    const { projectId } = modelProviderListProjectInputSchema.parse(input);
    return this.scopes
      .getProjectScopes(projectId)
      .then((projectScopes) => this.providers.hasEnabledForScopes(projectScopes))
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "project_not_found") return false;
        throw error;
      });
  }
}
