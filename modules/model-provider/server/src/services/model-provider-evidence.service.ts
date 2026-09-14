import { modelProviderListProjectInputSchema } from "@langwatch/model-provider-contract";
import type {
  ModelCostProjectScope
} from "../app/model-provider.members.ts";
import type {
  ModelProviderEvidenceRepository
} from "../repositories/model-provider-evidence.repository.ts";

/**
 * Whether a project has a model provider attached and switched on — one boolean, kept separate
 * from `ModelProviderApi` since this reads no auth/credential state. Checks the full
 * PROJECT -> TEAM -> ORGANIZATION cascade, since an org-wide credential counts for every project
 * under it. Returns false rather than throwing on an unreadable project, so the checklist never
 * wrongly reports the step done.
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
    const projectScopes = await this.scopes.tryGetProjectScopes(projectId);

    return projectScopes ? this.providers.hasEnabledForScopes(projectScopes) : false;
  }
}
