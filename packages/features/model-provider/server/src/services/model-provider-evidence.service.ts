import { modelProviderListProjectInputSchema } from "@langwatch/model-provider-contract";
import type {
  ModelCostProjectScopePort,
  ModelProviderEvidenceRepository,
} from "../ports/model-provider.port";

/**
 * Whether a project has a model provider attached and switched on.
 *
 * The setup checklist's provider step, and nothing else: one boolean, derived
 * from the project's own scope chain and one existence read. It is a service of
 * its own for the same reason {@link ModelCostCatalogService} is — composing
 * `ModelProviderService` to answer it would mean an organization service, an
 * authz service, a provider catalog, a translation port, an id service, a
 * credential codec, a Codex token refresher and a connection rate limiter, for
 * a question that asks none of them anything.
 *
 * THE CASCADE IS THE POINT. A provider is visible to a project through
 * `PROJECT` -> `TEAM` -> `ORGANIZATION`, so an organization-wide credential
 * counts toward every project under it. Matching the project scope alone left
 * this step stuck incomplete for organization-scoped credentials, which is a
 * checklist telling somebody to redo work they had already done.
 *
 * WHY FALSE RATHER THAN AN ERROR. A project that cannot be read has no scopes
 * and therefore no providers visible through them, and the checklist reports
 * the step as not started. That is the safe direction: a checklist that
 * wrongly says "done" stops somebody finishing their setup.
 */
export class ModelProviderEvidenceService {
  private constructor(
    private readonly providers: ModelProviderEvidenceRepository,
    private readonly scopes: ModelCostProjectScopePort,
  ) {}

  static create(options: {
    providers: ModelProviderEvidenceRepository;
    scopes: ModelCostProjectScopePort;
  }): ModelProviderEvidenceService {
    return new ModelProviderEvidenceService(options.providers, options.scopes);
  }

  async hasEnabledProvider(input: { projectId: string }): Promise<boolean> {
    const { projectId } = modelProviderListProjectInputSchema.parse(input);
    const projectScopes = await this.scopes.tryGetProjectScopes(projectId);

    return projectScopes ? this.providers.hasEnabledForScopes(projectScopes) : false;
  }
}
