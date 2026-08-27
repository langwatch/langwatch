import {
  modelProviderExecutionSchema,
  modelProviderListOrganizationInputSchema,
  modelProviderListProjectInputSchema,
  modelProviderSummarySchema,
  type ModelDefaultScope,
  type ModelProvider,
  type ModelProviderExecution,
  type ModelProviderSummary,
} from "@langwatch/model-provider-contract";
import type {
  ModelProviderCatalog,
  ModelProviderCredentialPolicy,
  ModelProviderRepository,
} from "../ports/model-provider.port";
import type { ModelProviderScopeService } from "./model-provider-scope.service";

type ModelProviderQueryOptions = {
  repository: ModelProviderRepository;
  scopes: ModelProviderScopeService;
  credentialPolicy: ModelProviderCredentialPolicy;
  catalog: ModelProviderCatalog;
};

export class ModelProviderQueryService {
  private constructor(private readonly options: ModelProviderQueryOptions) {}

  static create(options: ModelProviderQueryOptions): ModelProviderQueryService {
    return new ModelProviderQueryService(options);
  }

  async listForProject(input: { projectId: string }): Promise<ModelProviderSummary[]> {
    const parsed = modelProviderListProjectInputSchema.parse(input);
    const { saved, system } = await this.getProjectCandidates(parsed.projectId);
    const savedProviders = new Set(saved.map((provider) => provider.provider));

    return [
      ...saved
        .filter((provider) => this.shouldKeep(provider, system))
        .map((provider) => this.toSummary(provider)),
      ...system.filter(
        (provider) => provider.enabled && !savedProviders.has(provider.provider),
      ),
    ].map((provider) => modelProviderSummarySchema.parse(provider));
  }

  async listForOrganization(input: {
    organizationId: string;
  }): Promise<ModelProviderSummary[]> {
    const parsed = modelProviderListOrganizationInputSchema.parse(input);
    const [saved, referenceCreatedAt] = await Promise.all([
      this.options.repository.listForOrganization(parsed.organizationId),
      this.options.scopes.tryGetOrganizationSystemReference(parsed.organizationId),
    ]);
    const system = referenceCreatedAt
      ? await this.options.catalog.systemProviders({
          ...parsed,
          referenceCreatedAt,
        })
      : [];
    const savedProviders = new Set(saved.map((provider) => provider.provider));

    return [
      ...saved
        .filter((provider) => this.shouldKeep(provider, system))
        .map((provider) => this.toSummary(provider)),
      ...system.filter(
        (provider) => provider.enabled && !savedProviders.has(provider.provider),
      ),
    ].map((provider) => modelProviderSummarySchema.parse(provider));
  }

  async getForProject(input: {
    projectId: string;
    provider?: string;
  }): Promise<Record<string, ModelProviderSummary>> {
    const { chain, saved, system } = await this.getProjectCandidates(input.projectId);
    const stored = saved.filter((provider) => this.shouldKeep(provider, system));
    const storedProviders = new Set(stored.map((provider) => provider.provider));
    const providers = [
      ...stored.map((provider) => this.toSummary(provider)),
      ...system.filter((provider) => !storedProviders.has(provider.provider)),
    ];
    const selected = this.selectProjectProviders(providers, chain, input.provider);

    return Object.fromEntries(selected.map((provider) => [provider.provider, provider]));
  }

  async tryGetProviderForProject(input: {
    projectId: string;
    provider: string;
  }): Promise<ModelProvider | null> {
    const parsed = modelProviderListProjectInputSchema.parse({
      projectId: input.projectId,
    });
    const projectScopes = await this.options.scopes.tryGetProjectScopes(parsed.projectId);
    if (!projectScopes) {
      return null;
    }

    return this.options.repository.tryFindByProviderForProject({
      projectScopes,
      provider: input.provider,
    });
  }

  async tryGetByIdForProject(input: {
    id: string;
    projectId: string;
  }): Promise<ModelProvider | null> {
    const projectScopes = await this.options.scopes.tryGetProjectScopes(input.projectId);
    if (!projectScopes) {
      return null;
    }

    return this.options.repository.tryFindById({
      id: input.id,
      projectScopes,
    });
  }

  async tryFindRowServingModel(input: {
    projectId: string;
    provider: string;
    model: string;
  }): Promise<ModelProvider | null> {
    const parsed = modelProviderListProjectInputSchema.parse({
      projectId: input.projectId,
    });
    const chain = await this.getProjectScopeChain(parsed.projectId);
    const rows = await this.options.repository.listForProject(chain);
    const candidates = rows.filter(
      (row) =>
        row.provider === input.provider &&
        row.enabled &&
        [...row.customModels, ...row.customEmbeddingsModels].some(
          (model) => model.id === input.model,
        ),
    );

    candidates.sort((left, right) => this.compareProjectProviders(left, right, chain));
    return candidates[0] ?? null;
  }

  async getExecutionProviders(input: {
    projectId: string;
  }): Promise<Record<string, ModelProviderExecution>> {
    const parsed = modelProviderListProjectInputSchema.parse(input);
    const { chain, saved, system } = await this.getProjectCandidates(parsed.projectId);
    const stored = saved.filter((provider) => this.shouldKeep(provider, system));
    const storedProviders = new Set(stored.map((provider) => provider.provider));
    const candidates: ModelProviderExecution[] = [
      ...stored.map((provider) => this.toExecutionProvider(provider)),
      ...system
        .filter((provider) => !storedProviders.has(provider.provider))
        .map((provider) => modelProviderExecutionSchema.parse(provider)),
    ];
    const selected = new Map<string, ModelProviderExecution>();
    for (const candidate of candidates) {
      const current = selected.get(candidate.provider);
      if (!current || this.compareProjectProviders(candidate, current, chain) < 0) {
        selected.set(candidate.provider, candidate);
      }
    }

    return Object.fromEntries(selected.entries());
  }

  private async getProjectCandidates(projectId: string): Promise<{
    chain: ModelDefaultScope[];
    saved: ModelProvider[];
    system: ModelProviderSummary[];
  }> {
    const context = await this.options.scopes.getProjectSystemContext(projectId);
    const [saved, system] = await Promise.all([
      this.options.repository.listForProject(context.scopes),
      this.options.catalog.systemProviders({
        projectId,
        referenceCreatedAt: context.referenceCreatedAt,
      }),
    ]);

    return { chain: context.scopes, saved, system };
  }

  private shouldKeep(provider: ModelProvider, system: ModelProviderSummary[]): boolean {
    if (provider.customKeys) {
      return true;
    }

    const defaultProvider = system.find(
      (candidate) => candidate.provider === provider.provider,
    );
    if (provider.enabled !== defaultProvider?.enabled) {
      return true;
    }

    return provider.customModels.length > 0 || provider.customEmbeddingsModels.length > 0;
  }

  private toSummary(provider: ModelProvider): ModelProviderSummary {
    const metadata = this.options.catalog.metadata(provider.provider);

    return {
      ...provider,
      ...metadata,
      customKeys: this.options.credentialPolicy.tryMask(provider.customKeys),
      extraHeaders: this.options.credentialPolicy.maskHeaders(provider.extraHeaders),
      isSystem: false,
      embeddingsUnsupported:
        provider.customEmbeddingsModels.length === 0 &&
        metadata.embeddingsModels.length === 0,
    };
  }

  private toExecutionProvider(provider: ModelProvider): ModelProviderExecution {
    const metadata = this.options.catalog.metadata(provider.provider);

    return modelProviderExecutionSchema.parse({
      ...provider,
      ...metadata,
      models: metadata.models,
      embeddingsModels: metadata.embeddingsModels,
      isSystem: false,
      embeddingsUnsupported:
        provider.customEmbeddingsModels.length === 0 &&
        metadata.embeddingsModels.length === 0,
    });
  }

  private selectProjectProviders(
    providers: ModelProviderSummary[],
    chain: ModelDefaultScope[],
    requestedProvider?: string,
  ): ModelProviderSummary[] {
    const selected = new Map<string, ModelProviderSummary>();
    for (const provider of providers) {
      if (requestedProvider && provider.provider !== requestedProvider) {
        continue;
      }

      const current = selected.get(provider.provider);
      if (!current || this.compareProjectProviders(provider, current, chain) < 0) {
        selected.set(provider.provider, provider);
      }
    }

    return [...selected.values()];
  }

  private compareProjectProviders(
    candidate: ModelProvider,
    current: ModelProvider,
    chain: ModelDefaultScope[],
  ): number {
    if (candidate.enabled !== current.enabled) {
      return candidate.enabled ? -1 : 1;
    }

    const candidateScope = this.scopeSpecificity(candidate.scopes, chain);
    const currentScope = this.scopeSpecificity(current.scopes, chain);
    if (candidateScope !== currentScope) {
      return currentScope - candidateScope;
    }

    const candidatePriority = candidate.fallbackPriorityGlobal ?? Number.MAX_SAFE_INTEGER;
    const currentPriority = current.fallbackPriorityGlobal ?? Number.MAX_SAFE_INTEGER;
    if (candidatePriority !== currentPriority) {
      return candidatePriority - currentPriority;
    }

    return candidate.createdAt.getTime() - current.createdAt.getTime();
  }

  private scopeSpecificity(
    scopes: ModelDefaultScope[],
    chain: ModelDefaultScope[],
  ): number {
    let specificity = 0;
    for (const scope of scopes) {
      const isVisible = chain.some(
        (item) => item.scopeType === scope.scopeType && item.scopeId === scope.scopeId,
      );
      if (!isVisible) {
        continue;
      }

      if (scope.scopeType === "PROJECT") {
        specificity = Math.max(specificity, 3);
      }
      if (scope.scopeType === "TEAM") {
        specificity = Math.max(specificity, 2);
      }
      if (scope.scopeType === "ORGANIZATION") {
        specificity = Math.max(specificity, 1);
      }
    }

    return specificity;
  }

  private async getProjectScopeChain(projectId: string): Promise<ModelDefaultScope[]> {
    return this.options.scopes.getProjectScopes(projectId);
  }
}
