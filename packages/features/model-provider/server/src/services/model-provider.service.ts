import {
  estimateModelCost,
  ModelCostNotFoundError,
  ModelDefaultNotFoundError,
  ModelProviderInvalidError,
  ModelProviderNotFoundError,
  ModelProviderScopesRequiredError,
  modelCostDeleteInputSchema,
  modelCostListInputSchema,
  modelCostWriteInputSchema,
  modelDefaultAssignmentInputSchema,
  modelDefaultConfigWriteInputSchema,
  modelDefaultResolveInputSchema,
  modelDefaultSnapshotInputSchema,
  modelDefaultSnapshotSchema,
  modelProviderApiKeyValidationInputSchema,
  modelProviderDeleteInputSchema,
  modelProviderCodexStatusInputSchema,
  modelProviderCodexStatusSchema,
  modelProviderListOrganizationInputSchema,
  modelProviderListProjectInputSchema,
  modelProviderTestConnectionInputSchema,
  modelProviderWriteInputSchema,
  modelProviderSchema,
  modelProviderExecutionSchema,
  modelProviderSummarySchema,
  translateInputSchema,
  type ModelCost,
  type ModelDefaultConfig,
  type ModelDefaultEffective,
  type ModelDefaultInheritedValues,
  type ModelDefaultScope,
  type ModelDefaultSnapshot,
  type ModelDefaultSnapshotInput,
  type ModelProvider,
  type ModelProviderExecution,
  ModelProviderService as ModelProviderServiceContract,
  type ModelCostEstimateInput,
  type ModelProviderApiKeyValidation,
  type ModelProviderCodexStatus,
  type ModelProviderSummary,
  type TranslateOutput,
} from "@langwatch/model-provider-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type {
  ManagedProviderService,
  ModelCostRepository,
  ModelDefaultRepository,
  ModelProviderAuthorization,
  ModelProviderCatalog,
  ModelProviderIdGenerator,
  ModelProviderRepository,
  ModelTranslationPort,
  ModelProviderCredentialPolicy,
  ModelProviderOnboardingDefaults,
} from "../ports/model-provider.port";

export interface ModelProviderServiceOptions {
  repository: ModelProviderRepository;
  projects: ProjectService;
  credentialPolicy: ModelProviderCredentialPolicy;
  defaults: ModelDefaultRepository;
  costs: ModelCostRepository;
  catalog: ModelProviderCatalog;
  managedProviders?: ManagedProviderService;
  authorization?: ModelProviderAuthorization;
  translation?: ModelTranslationPort;
  onboardingDefaults?: ModelProviderOnboardingDefaults;
  generateId?: ModelProviderIdGenerator;
}

export class ModelProviderService extends ModelProviderServiceContract {
  private constructor(private readonly options: ModelProviderServiceOptions) {
    super();
  }

  static create(options: ModelProviderServiceOptions): ModelProviderService {
    return new ModelProviderService(options);
  }

  estimateCost(input: ModelCostEstimateInput): number {
    return estimateModelCost(input, this.options.catalog.staticCostRates());
  }

  async listForProject(input: { projectId: string }): Promise<ModelProviderSummary[]> {
    const parsed = modelProviderListProjectInputSchema.parse(input);
    const [saved, system] = await Promise.all([
      this.options.repository.listForProject(parsed.projectId),
      this.options.catalog.systemProviders(parsed),
    ]);
    const savedProviders = new Set(saved.map((provider) => provider.provider));
    return [
      ...saved.map((provider) => this.toSummary(provider)),
      ...system.filter((provider) => !savedProviders.has(provider.provider)),
    ].map((provider) => modelProviderSummarySchema.parse(provider));
  }

  async listForOrganization(input: {
    organizationId: string;
  }): Promise<ModelProviderSummary[]> {
    const parsed = modelProviderListOrganizationInputSchema.parse(input);
    const [saved, system] = await Promise.all([
      this.options.repository.listForOrganization(parsed.organizationId),
      this.options.catalog.systemProviders(parsed),
    ]);
    const savedProviders = new Set(saved.map((provider) => provider.provider));
    return [
      ...saved.map((provider) => this.toSummary(provider)),
      ...system.filter((provider) => !savedProviders.has(provider.provider)),
    ].map((provider) => modelProviderSummarySchema.parse(provider));
  }

  async getForProject(input: {
    projectId: string;
    provider?: string;
  }): Promise<Record<string, ModelProviderSummary>> {
    const providers = await this.listForProject(input);
    const chain = await this.getProjectScopeChain(input.projectId);
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
    return this.options.repository.tryFindByProviderForProject({
      projectId: parsed.projectId,
      provider: input.provider,
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
    const rows = await this.options.repository.listForProject(parsed.projectId);
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
    const [saved, system, chain] = await Promise.all([
      this.options.repository.listForProject(parsed.projectId),
      this.options.catalog.systemProviders(parsed),
      this.getProjectScopeChain(parsed.projectId),
    ]);
    const candidates: ModelProviderExecution[] = [
      ...saved.map((provider) => this.toExecutionProvider(provider)),
      ...system
        .filter(
          (provider) =>
            !saved.some((savedProvider) => savedProvider.provider === provider.provider),
        )
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

  async upsert(
    input: Parameters<ModelProviderServiceContract["upsert"]>[0],
  ): Promise<ModelProvider> {
    const parsed = modelProviderWriteInputSchema.parse(input);
    if (!this.options.catalog.exists(parsed.provider)) {
      throw new ModelProviderInvalidError(`Unknown provider: ${parsed.provider}`);
    }
    if (!parsed.id && !parsed.scopes && !parsed.projectId) {
      throw new ModelProviderScopesRequiredError();
    }
    const existing = parsed.id
      ? await this.options.repository.tryFindById({
          id: parsed.id,
          organizationId: parsed.organizationId,
          projectId: parsed.projectId,
        })
      : await this.options.repository.tryFindByProviderForProject({
          provider: parsed.provider,
          projectId: parsed.projectId ?? "",
        });
    if (parsed.id && !existing) {
      throw new ModelProviderNotFoundError();
    }
    const scopes =
      parsed.scopes ??
      (parsed.projectId
        ? [{ scopeType: "PROJECT" as const, scopeId: parsed.projectId }]
        : (existing?.scopes ?? []));
    const organizationId =
      existing?.organizationId ??
      (await this.options.repository.tryResolveOrganizationId({
        projectId: parsed.projectId,
        organizationId: parsed.organizationId,
      }));
    if (!organizationId) {
      throw new ModelProviderInvalidError(
        "Provider scope does not resolve to an organization",
      );
    }
    if (
      organizationId !==
      (await this.options.repository.resolveOrganizationIdForScopes(scopes))
    ) {
      throw new ModelProviderInvalidError(
        "Provider scopes must belong to one organization",
      );
    }
    const now = new Date();
    const normalizedCredentials =
      parsed.customKeys === undefined
        ? undefined
        : this.options.credentialPolicy.normalize(parsed.provider, parsed.customKeys);
    if (
      existing &&
      normalizedCredentials !== undefined &&
      existing.customKeys === null &&
      (await this.options.repository.hasStoredCredentials(existing.id)) &&
      !this.options.credentialPolicy.hasUsableReplacement(normalizedCredentials)
    ) {
      throw new ModelProviderInvalidError(
        "Stored provider credentials are unreadable; enter a replacement credential before saving.",
      );
    }
    const customKeys =
      normalizedCredentials === undefined
        ? (existing?.customKeys ?? null)
        : this.options.credentialPolicy.merge({
            incoming: normalizedCredentials,
            stored: existing?.customKeys ?? null,
          });
    const extraHeaders =
      parsed.extraHeaders === undefined
        ? (existing?.extraHeaders ?? [])
        : this.options.credentialPolicy.mergeHeaders({
            incoming: parsed.extraHeaders ?? [],
            stored: existing?.extraHeaders ?? [],
          });
    const value: ModelProvider = modelProviderSchema.parse({
      id:
        existing?.id ??
        parsed.id ??
        this.options.generateId?.() ??
        generateId("model_provider"),
      organizationId,
      provider: parsed.provider,
      name: parsed.name ?? existing?.name ?? humanize(parsed.provider),
      enabled: parsed.enabled,
      defaultModel: parsed.defaultModel,
      routingHandle:
        parsed.routingHandle === undefined
          ? (existing?.routingHandle ?? null)
          : parsed.routingHandle,
      scopes,
      customKeys,
      customModels:
        parsed.customModels === undefined
          ? (existing?.customModels ?? [])
          : (parsed.customModels ?? []),
      customEmbeddingsModels:
        parsed.customEmbeddingsModels === undefined
          ? (existing?.customEmbeddingsModels ?? [])
          : (parsed.customEmbeddingsModels ?? []),
      extraHeaders,
      rateLimitRpm:
        parsed.rateLimitRpm === undefined
          ? (existing?.rateLimitRpm ?? null)
          : parsed.rateLimitRpm,
      rateLimitTpm:
        parsed.rateLimitTpm === undefined
          ? (existing?.rateLimitTpm ?? null)
          : parsed.rateLimitTpm,
      rateLimitRpd:
        parsed.rateLimitRpd === undefined
          ? (existing?.rateLimitRpd ?? null)
          : parsed.rateLimitRpd,
      fallbackPriorityGlobal:
        parsed.fallbackPriorityGlobal === undefined
          ? (existing?.fallbackPriorityGlobal ?? null)
          : parsed.fallbackPriorityGlobal,
      providerConfig:
        parsed.providerConfig === undefined
          ? (existing?.providerConfig ?? null)
          : parsed.providerConfig,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    if (value.organizationId.length === 0) {
      throw new ModelProviderInvalidError(
        "organizationId is required by the persistence boundary",
      );
    }
    const saved = existing
      ? await this.options.repository.update(value)
      : await this.options.repository.create(value);
    if (!existing && this.options.onboardingDefaults) {
      await this.options.onboardingDefaults.seed({
        provider: saved.provider,
        scopes: saved.scopes,
      });
    }
    if (parsed.defaultModel !== undefined && parsed.projectId) {
      await this.options.defaults.set({
        scope: { scopeType: "PROJECT", scopeId: parsed.projectId },
        key: "DEFAULT",
        model: parsed.defaultModel,
        authorId: null,
      });
    }
    return saved;
  }

  async delete(
    input: Parameters<ModelProviderServiceContract["delete"]>[0],
  ): Promise<void> {
    const parsed = modelProviderDeleteInputSchema.parse(input);
    const existing = parsed.id
      ? await this.options.repository.tryFindById({
          id: parsed.id,
          organizationId: parsed.organizationId,
          projectId: parsed.projectId,
        })
      : await this.options.repository.tryFindByProviderForProject({
          provider: parsed.provider,
          projectId: parsed.projectId ?? "",
        });
    if (!existing) {
      throw new ModelProviderNotFoundError();
    }
    await this.options.repository.delete({
      id: existing.id,
      organizationId: existing.organizationId,
      projectId: parsed.projectId,
    });
  }

  async validateApiKey(
    input: Parameters<ModelProviderServiceContract["validateApiKey"]>[0],
  ): Promise<ModelProviderApiKeyValidation> {
    const parsed = modelProviderApiKeyValidationInputSchema.parse(input);
    if (!this.options.catalog.exists(parsed.provider)) {
      throw new ModelProviderInvalidError(`Unknown provider: ${parsed.provider}`);
    }
    return this.options.catalog.validateApiKey(parsed.provider, parsed.customKeys);
  }

  async testConnection(
    input: Parameters<ModelProviderServiceContract["testConnection"]>[0],
  ): Promise<{ connected: boolean }> {
    const parsed = modelProviderTestConnectionInputSchema.parse(input);
    const provider = await this.options.repository.tryFindById({
      id: parsed.modelProviderId,
      organizationId: parsed.organizationId,
      projectId: parsed.projectId,
    });
    if (!provider) {
      throw new ModelProviderNotFoundError();
    }
    return this.options.catalog.testConnection(
      provider.provider,
      provider.customKeys ?? {},
    );
  }

  async getCodexStatus(
    input: Parameters<ModelProviderServiceContract["getCodexStatus"]>[0],
  ): Promise<ModelProviderCodexStatus> {
    const parsed = modelProviderCodexStatusInputSchema.parse(input);
    const provider = await this.options.repository.tryFindByProviderForProject({
      provider: "openai_codex",
      projectId: parsed.projectId,
    });
    if (!provider?.enabled) {
      return modelProviderCodexStatusSchema.parse({ connected: false });
    }
    const plan = provider.customKeys?.CODEX_PLAN;
    return modelProviderCodexStatusSchema.parse({
      connected: true,
      providerId: provider.id,
      plan: typeof plan === "string" ? plan : "",
    });
  }

  private normalizedDefaultModel(key: string, model: string): string | null {
    return this.options.catalog.tryNormalizeDefaultModel({ key, model });
  }

  private resolveConfiguredDefault(
    configs: ModelDefaultConfig[],
    chain: ModelDefaultScope[],
    key: string,
    role: string,
    expandModel = true,
  ): ModelDefaultEffective | null {
    const tiers = [
      { type: "PROJECT" as const, label: "project" as const },
      { type: "TEAM" as const, label: "team" as const },
      { type: "ORGANIZATION" as const, label: "organization" as const },
    ];
    const valueAt = (
      candidateKey: string,
      tier: (typeof tiers)[number],
    ): ModelDefaultEffective | null => {
      const scopeIds = new Set(
        chain
          .filter((scope) => scope.scopeType === tier.type)
          .map((scope) => scope.scopeId),
      );
      if (scopeIds.size === 0) {
        return null;
      }
      const candidates = configs
        .filter((config) =>
          config.scopes.some(
            (scope) => scope.scopeType === tier.type && scopeIds.has(scope.scopeId),
          ),
        )
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      for (const config of candidates) {
        const raw = config.config[candidateKey];
        if (!raw) {
          continue;
        }
        const model = expandModel ? this.normalizedDefaultModel(candidateKey, raw) : raw;
        if (!model) {
          continue;
        }
        return {
          model,
          source: candidateKey.includes(".") ? "feature_override" : "role_default",
          scope: tier.label,
        };
      }
      return null;
    };
    for (const tier of tiers) {
      const feature = valueAt(key, tier);
      if (feature) {
        return feature;
      }
      if (role !== key) {
        const fallback = valueAt(role, tier);
        if (fallback) {
          return fallback;
        }
      }
    }
    return null;
  }

  private projectChain(input: {
    projectId: string;
    teamId: string | null;
    organizationId: string | null;
  }): ModelDefaultScope[] {
    return [
      { scopeType: "PROJECT", scopeId: input.projectId },
      ...(input.teamId ? [{ scopeType: "TEAM" as const, scopeId: input.teamId }] : []),
      ...(input.organizationId
        ? [{ scopeType: "ORGANIZATION" as const, scopeId: input.organizationId }]
        : []),
    ];
  }

  isManagedProvider(input: { organizationId: string; provider: string }): boolean {
    return (
      this.options.managedProviders?.isManagedProvider(
        input.organizationId,
        input.provider,
      ) ?? false
    );
  }

  async getDefaultSnapshot(
    input: ModelDefaultSnapshotInput,
  ): Promise<ModelDefaultSnapshot> {
    const parsed = modelDefaultSnapshotInputSchema.parse(input);
    const context = await this.options.defaults.getProjectContext(parsed.projectId);
    const configs = context.organizationId
      ? await this.options.defaults.listForOrganization(context.organizationId)
      : await this.options.defaults.listForProject(parsed.projectId);
    const visible =
      parsed.actorId && this.options.authorization
        ? (
            await Promise.all(
              configs.map(async (config) => ({
                config,
                scopes: (
                  await Promise.all(
                    config.scopes.map(async (scope) => ({
                      scope,
                      allowed: await this.options.authorization!.canRead({
                        actorId: parsed.actorId!,
                        scopeType: scope.scopeType,
                        scopeId: scope.scopeId,
                      }),
                    })),
                  )
                )
                  .filter(({ allowed }) => allowed)
                  .map(({ scope }) => scope),
              })),
            )
          )
            .filter(({ scopes }) => scopes.length > 0)
            .map(({ config, scopes }) => ({ ...config, scopes }))
        : configs;
    const chain = this.projectChain({
      projectId: parsed.projectId,
      teamId: context.teamId,
      organizationId: context.organizationId,
    });
    const effective: Record<string, ModelDefaultEffective | null> = {};
    const features = this.options.catalog.defaultFeatures();
    const roles = new Set([
      "DEFAULT",
      "FAST",
      "LANGY",
      "EMBEDDINGS",
      ...features.map((feature) => feature.role),
    ]);
    for (const role of roles) {
      const proxy = features.find((feature) => feature.role === role);
      effective[role] = this.resolveConfiguredDefault(
        visible,
        chain,
        proxy?.key ?? role,
        role,
      );
    }
    for (const feature of features) {
      effective[feature.key] = this.resolveConfiguredDefault(
        visible,
        chain,
        feature.key,
        feature.role,
      );
    }
    const available = context.organizationId
      ? await this.options.defaults.listOrganizationScopes(context.organizationId)
      : {
          organization: null,
          teams: [],
          projects: [
            {
              id: parsed.projectId,
              name: parsed.projectId,
              teamId: context.teamId ?? "",
            },
          ],
        };
    const writable =
      parsed.actorId && this.options.authorization
        ? {
            organization:
              available.organization &&
              (await this.options.authorization.canWrite({
                actorId: parsed.actorId,
                scopeType: "ORGANIZATION",
                scopeId: available.organization.id,
              }))
                ? available.organization
                : null,
            teams: (
              await Promise.all(
                available.teams.map(async (scope) => ({
                  scope,
                  allowed: await this.options.authorization!.canWrite({
                    actorId: parsed.actorId!,
                    scopeType: "TEAM",
                    scopeId: scope.id,
                  }),
                })),
              )
            )
              .filter(({ allowed }) => allowed)
              .map(({ scope }) => scope),
            projects: (
              await Promise.all(
                available.projects.map(async (scope) => ({
                  scope,
                  allowed: await this.options.authorization!.canWrite({
                    actorId: parsed.actorId!,
                    scopeType: "PROJECT",
                    scopeId: scope.id,
                  }),
                })),
              )
            )
              .filter(({ allowed }) => allowed)
              .map(({ scope }) => scope),
          }
        : { organization: null, teams: [], projects: [] };
    const names = new Map<string, string>([
      ...(available.organization
        ? [[available.organization.id, available.organization.name] as const]
        : []),
      ...available.teams.map((scope) => [scope.id, scope.name] as const),
      ...available.projects.map((scope) => [scope.id, scope.name] as const),
    ]);
    return modelDefaultSnapshotSchema.parse({
      projectId: parsed.projectId,
      teamId: context.teamId,
      organizationId: context.organizationId,
      organizationName: context.organizationName,
      effective,
      configs: visible.map((config) => ({
        id: config.id,
        config: config.config,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt ?? config.createdAt,
        authorId: config.authorId,
        scopes: config.scopes.map((scope) => ({
          type: scope.scopeType,
          id: scope.scopeId,
          name: names.get(scope.scopeId) ?? scope.scopeId,
        })),
      })),
      available: writable,
      features: this.options.catalog.defaultFeatures(),
    });
  }

  async getInheritedValues(input: {
    projectId: string;
    scopes: import("@langwatch/model-provider-contract").ModelDefaultScope[];
    excludeConfigId?: string;
  }): Promise<ModelDefaultInheritedValues> {
    const context = await this.options.defaults.getProjectContext(input.projectId);
    const reference = [...input.scopes].sort(
      (a, b) =>
        ({ PROJECT: 0, TEAM: 1, ORGANIZATION: 2 })[a.scopeType] -
        { PROJECT: 0, TEAM: 1, ORGANIZATION: 2 }[b.scopeType],
    )[0];
    if (!reference) {
      throw new ModelProviderInvalidError("At least one scope is required");
    }
    const available = context.organizationId
      ? await this.options.defaults.listOrganizationScopes(context.organizationId)
      : {
          organization: null,
          teams: [],
          projects: [
            { id: input.projectId, name: input.projectId, teamId: context.teamId ?? "" },
          ],
        };
    const validScope = (scope: ModelDefaultScope): boolean => {
      if (scope.scopeType === "ORGANIZATION") {
        return scope.scopeId === context.organizationId;
      }
      if (scope.scopeType === "TEAM") {
        return available.teams.some((team) => team.id === scope.scopeId);
      }
      return available.projects.some((project) => project.id === scope.scopeId);
    };
    if (input.scopes.some((scope) => !validScope(scope))) {
      throw new ModelProviderInvalidError(
        "Default scope does not belong to the project organization",
      );
    }
    const excluded = new Set(
      input.scopes.map((scope) => `${scope.scopeType}:${scope.scopeId}`),
    );
    const referenceProject =
      reference.scopeType === "PROJECT"
        ? available.projects.find((project) => project.id === reference.scopeId)
        : undefined;
    const chain: ModelDefaultScope[] = [];
    if (reference.scopeType === "PROJECT") {
      chain.push({ scopeType: "PROJECT", scopeId: reference.scopeId });
      if (referenceProject?.teamId) {
        chain.push({ scopeType: "TEAM", scopeId: referenceProject.teamId });
      }
      if (context.organizationId) {
        chain.push({ scopeType: "ORGANIZATION", scopeId: context.organizationId });
      }
    } else if (reference.scopeType === "TEAM") {
      chain.push({ scopeType: "TEAM", scopeId: reference.scopeId });
      if (context.organizationId) {
        chain.push({ scopeType: "ORGANIZATION", scopeId: context.organizationId });
      }
    } else {
      chain.push({ scopeType: "ORGANIZATION", scopeId: reference.scopeId });
    }
    const inheritedConfigs = (
      context.organizationId
        ? await this.options.defaults.listForOrganization(context.organizationId)
        : await this.options.defaults.listForProject(input.projectId)
    ).filter((config) => config.id !== input.excludeConfigId);
    const tiers: ModelDefaultScope[] = chain.filter(
      (scope) => !excluded.has(`${scope.scopeType}:${scope.scopeId}`),
    );
    const inherited: ModelDefaultInheritedValues["inherited"] = {};
    const features = this.options.catalog.defaultFeatures();
    const keys = [
      "DEFAULT",
      "FAST",
      "LANGY",
      "EMBEDDINGS",
      ...features.map((feature) => feature.key),
    ];
    for (const key of keys) {
      const role = features.find((feature) => feature.key === key)?.role ?? key;
      let hit = this.resolveConfiguredDefault(inheritedConfigs, tiers, key, role, false);
      if (!hit && !key.includes(".")) {
        const providers = (await this.options.repository.listForProject(input.projectId))
          .filter((provider) => provider.enabled)
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
        const provider = providers[0];
        const inferred = provider
          ? this.options.catalog.inferredDefaultsForProvider(provider.provider)[key]
          : undefined;
        if (inferred) {
          hit = {
            model: this.normalizedDefaultModel(key, inferred) ?? inferred,
            source: "inferred",
            scope: null,
            inferredFromProvider: provider?.provider,
          };
        }
      }
      inherited[key] = hit;
    }
    for (const feature of features) {
      inherited[feature.key] = inherited[feature.key] ?? inherited[feature.role] ?? null;
    }
    return { inherited, referenceScope: reference };
  }

  async tryGetResolvedDefault(
    input: Parameters<ModelProviderServiceContract["tryGetResolvedDefault"]>[0],
  ): Promise<import("@langwatch/model-provider-contract").ModelDefaultEffective | null> {
    const parsed = modelDefaultResolveInputSchema.parse(input);
    const snapshot = await this.getDefaultSnapshot({ projectId: parsed.projectId });
    const direct = snapshot.effective[parsed.featureKey];
    if (direct) {
      return direct;
    }
    const descriptor = this.options.catalog
      .defaultFeatures()
      .find((feature) => feature.key === parsed.featureKey);
    if (descriptor) {
      const role = snapshot.effective[descriptor.role];
      if (role) {
        return role;
      }
    }
    return parsed.featureKey === "langy.chat"
      ? (snapshot.effective["prompt.create_default"] ?? null)
      : null;
  }

  async setDefault(
    input: Parameters<ModelProviderServiceContract["setDefault"]>[0],
  ): Promise<void> {
    const parsed = modelDefaultAssignmentInputSchema.parse(input);
    const clean = this.options.catalog.sanitizeDefaultConfig({
      [parsed.key]: parsed.model ?? "",
    });
    if (parsed.model !== null && !clean[parsed.key]) {
      throw new ModelProviderInvalidError(
        `Model is not allowed for default key: ${parsed.key}`,
      );
    }
    const actorId = parsed.actorId ?? parsed.authorId;
    if (actorId) {
      await this.authorizeWrite(actorId, [parsed.scope]);
    }
    await this.options.defaults.set({ ...parsed, authorId: parsed.authorId ?? null });
  }

  async saveDefaultConfig(
    input: Parameters<ModelProviderServiceContract["saveDefaultConfig"]>[0],
  ): Promise<ModelDefaultConfig> {
    const parsed = modelDefaultConfigWriteInputSchema.parse(input);
    const existing = parsed.id ? await this.options.defaults.tryGetById(parsed.id) : null;
    if (parsed.id && !existing) {
      throw new ModelDefaultNotFoundError();
    }
    if (existing && existing.scopes.length === 0) {
      throw new ModelDefaultNotFoundError();
    }
    if (parsed.scopes?.length === 0) {
      if (!existing) {
        throw new ModelDefaultNotFoundError();
      }
      if (parsed.actorId) {
        await this.authorizeWrite(parsed.actorId, existing.scopes);
      }
      await this.options.defaults.delete(existing.id);
      return existing;
    }
    const config = this.options.catalog.sanitizeDefaultConfig(
      parsed.config ?? existing?.config ?? {},
    );
    if (Object.keys(config).length === 0) {
      throw new ModelProviderInvalidError("Pick at least one model");
    }
    const scopes = parsed.scopes ?? existing?.scopes ?? [];
    if (scopes.length === 0) {
      throw new ModelProviderInvalidError("Pick at least one scope");
    }
    if (parsed.actorId) {
      await this.authorizeWrite(parsed.actorId, [...(existing?.scopes ?? []), ...scopes]);
    }
    const saved = await this.options.defaults.save({
      id: parsed.id ?? this.options.generateId?.() ?? generateId("model_default"),
      config,
      scopes,
      authorId: parsed.authorId ?? existing?.authorId ?? null,
    });
    return saved;
  }

  async tryGetDefaultConfig(input: { id: string }): Promise<ModelDefaultConfig | null> {
    return this.options.defaults.tryGetById(input.id);
  }

  async deleteDefaultConfig(
    input: Parameters<ModelProviderServiceContract["deleteDefaultConfig"]>[0],
  ): Promise<void> {
    const existing = await this.options.defaults.tryGetById(input.id);
    if (!existing || existing.scopes.length === 0) {
      throw new ModelDefaultNotFoundError();
    }
    if (input.actorId) {
      await this.authorizeWrite(input.actorId, existing.scopes);
    }
    await this.options.defaults.delete(input.id);
  }

  private async authorizeWrite(
    actorId: string,
    scopes: Array<{ scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }>,
  ): Promise<void> {
    if (!this.options.authorization) {
      throw new ModelProviderInvalidError(
        "Model Provider authorization is not configured",
      );
    }
    const unique = new Map(
      scopes.map((scope) => [`${scope.scopeType}:${scope.scopeId}`, scope]),
    );
    for (const scope of unique.values()) {
      if (!(await this.options.authorization.canWrite({ actorId, ...scope }))) {
        throw new ModelProviderInvalidError(
          `Cannot manage ${scope.scopeType.toLowerCase()} scope`,
        );
      }
    }
  }

  listCosts(input: { projectId: string }): Promise<ModelCost[]> {
    return this.options.costs.listForProject(
      modelCostListInputSchema.parse(input).projectId,
    );
  }

  async upsertCost(
    input: Parameters<ModelProviderServiceContract["upsertCost"]>[0],
  ): Promise<ModelCost> {
    const parsed = modelCostWriteInputSchema.parse(input);
    const existing = parsed.id ? await this.options.costs.tryFindById(parsed.id) : null;
    if (parsed.id && !existing) {
      throw new ModelCostNotFoundError();
    }
    const organizationId = await this.options.costs.tryResolveOrganizationId({
      projectId: parsed.projectId,
      scopeType: parsed.scopeType,
      scopeId: parsed.scopeId,
    });
    if (!organizationId) {
      throw new ModelProviderInvalidError(
        "Cost scope does not resolve to an organization",
      );
    }
    if (existing && existing.organizationId !== organizationId) {
      throw new ModelProviderInvalidError("Cost cannot move between organizations");
    }
    if (parsed.actorId && !this.options.authorization) {
      throw new ModelProviderInvalidError(
        "Model Provider authorization is not configured",
      );
    }
    if (parsed.actorId && this.options.authorization) {
      const scopeType = parsed.scopeType ?? "PROJECT";
      const scopeId = parsed.scopeId ?? parsed.projectId;
      if (
        existing &&
        !(await this.options.authorization.canWrite({
          actorId: parsed.actorId,
          scopeType: existing.scopeType,
          scopeId: existing.scopeId,
        }))
      ) {
        throw new ModelProviderInvalidError("Cannot manage the current cost scope");
      }
      if (
        !(await this.options.authorization.canWrite({
          actorId: parsed.actorId,
          scopeType,
          scopeId,
        }))
      ) {
        throw new ModelProviderInvalidError("Cannot manage cost scope");
      }
    }
    const now = new Date();
    return this.options.costs.save({
      id:
        existing?.id ??
        parsed.id ??
        this.options.generateId?.() ??
        generateId("model_cost"),
      organizationId,
      scopeType: parsed.scopeType ?? existing?.scopeType ?? "PROJECT",
      scopeId: parsed.scopeId ?? existing?.scopeId ?? parsed.projectId,
      model: parsed.model,
      regex: parsed.regex,
      inputCostPerToken: parsed.inputCostPerToken ?? null,
      outputCostPerToken: parsed.outputCostPerToken ?? null,
      cacheReadCostPerToken: parsed.cacheReadCostPerToken ?? null,
      cacheCreationCostPerToken: parsed.cacheCreationCostPerToken ?? null,
      cacheCreation1hCostPerToken: parsed.cacheCreation1hCostPerToken ?? null,
      createdAt: existing?.createdAt ?? now,
    });
  }

  async deleteCost(
    input: Parameters<ModelProviderServiceContract["deleteCost"]>[0],
  ): Promise<void> {
    const parsed = modelCostDeleteInputSchema.parse(input);
    const existing = await this.options.costs.tryFindById(parsed.id);
    if (!existing) {
      throw new ModelCostNotFoundError();
    }
    const organizationId = await this.options.costs.tryResolveOrganizationId({
      projectId: parsed.projectId,
    });
    if (!organizationId || organizationId !== existing.organizationId) {
      throw new ModelCostNotFoundError();
    }
    if (parsed.actorId && !this.options.authorization) {
      throw new ModelProviderInvalidError(
        "Model Provider authorization is not configured",
      );
    }
    if (
      parsed.actorId &&
      this.options.authorization &&
      !(await this.options.authorization.canWrite({
        actorId: parsed.actorId,
        scopeType: existing.scopeType,
        scopeId: existing.scopeId,
      }))
    ) {
      throw new ModelProviderInvalidError("Cannot manage cost scope");
    }
    await this.options.costs.delete(parsed.id);
  }

  async translate(
    input: Parameters<ModelProviderServiceContract["translate"]>[0],
  ): Promise<TranslateOutput> {
    if (!this.options.translation) {
      throw new ModelProviderInvalidError("Translation is not configured");
    }
    const parsed = translateInputSchema.parse(input);
    const model = await this.options.defaults.tryResolve({
      projectId: parsed.projectId,
      featureKey: "translate.text",
    });
    if (!model) {
      throw new ModelProviderInvalidError("No translation model is configured");
    }
    return {
      translation: await this.options.translation.translate({
        ...parsed,
        model,
        modelProviders: this,
      }),
    };
  }

  private toSummary(provider: ModelProvider): ModelProviderSummary {
    const metadata = this.options.catalog.metadata(provider.provider);
    return {
      ...provider,
      ...metadata,
      customKeys: this.options.credentialPolicy.mask(provider.customKeys),
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
      if (!current || this.isPreferredForProject(provider, current, chain)) {
        selected.set(provider.provider, provider);
      }
    }

    return [...selected.values()];
  }

  private isPreferredForProject(
    candidate: ModelProviderSummary,
    current: ModelProviderSummary,
    chain: ModelDefaultScope[],
  ): boolean {
    return this.compareProjectProviders(candidate, current, chain) < 0;
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
    const project = await this.options.projects.getWithTeam(projectId);

    return [
      { scopeType: "PROJECT", scopeId: project.id },
      { scopeType: "TEAM", scopeId: project.teamId },
      { scopeType: "ORGANIZATION", scopeId: project.team.organizationId },
    ];
  }
}

function humanize(provider: string): string {
  return provider.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
