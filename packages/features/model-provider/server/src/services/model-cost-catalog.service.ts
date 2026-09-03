import { modelCostListInputSchema, type ModelCost } from "@langwatch/model-provider-contract";
import type { ModelCostProjectScopePort, ModelCostRepository } from "../ports/model-provider.port";

/**
 * The cost rules a project has stored, listed.
 *
 * One read, on the cost repository and a scope derivation. It was a method of
 * `ModelProviderCostsService`, which still answers it — it composes this and
 * delegates, so there is one implementation and no twin to drift — but a
 * process that only prices spans can now compose it WITHOUT the rest of the
 * feature.
 *
 * The distinction is a real one. `ModelProviderService` requires an
 * `OrganizationService`, an `AuthzService`, a provider catalog, a translation
 * port, an id service, a credential codec, a Codex token refresher and a
 * connection rate limiter, because writing a cost authorizes a scope, minting
 * one needs an id and every credential path decrypts a key. This listing
 * reaches none of them: a project's scopes come off its own row, and the rows
 * are read by scope with no authorization decision to make, because ingestion
 * is already inside the tenant whose costs it is reading.
 *
 * WHY THE EMPTY LIST RATHER THAN AN ERROR. A project that cannot be read has
 * no scopes and therefore no custom rates, and the caller falls back to the
 * static catalog. Raising here would fail the fold of a span for a project
 * that was archived mid-flight.
 */
export class ModelCostCatalogService {
  private constructor(
    private readonly costs: ModelCostRepository,
    private readonly scopes: ModelCostProjectScopePort,
  ) {}

  static create(options: {
    costs: ModelCostRepository;
    scopes: ModelCostProjectScopePort;
  }): ModelCostCatalogService {
    return new ModelCostCatalogService(options.costs, options.scopes);
  }

  async listCosts(input: { projectId: string }): Promise<ModelCost[]> {
    const projectId = modelCostListInputSchema.parse(input).projectId;
    const projectScopes = await this.scopes.tryGetProjectScopes(projectId);

    return projectScopes ? this.costs.listForProject(projectScopes) : [];
  }
}
