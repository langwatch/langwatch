import {
  expandLatestAlias,
  isLatestAlias,
  isModelAllowedForFeature,
  LANGY_CHAT_FEATURE_KEY,
  ModelNotConfiguredError,
  ModelProviderInvalidError,
  ModelRestrictedForFeatureError,
  modelDefaultResolveInputSchema,
  modelProviderResolutionSchema,
  type ModelDefaultConfig,
  type ModelDefaultFeature,
  type ModelDefaultResolveInput,
  type ModelDefaultScope,
  type ModelProviderAlternateResolution,
  type ModelProviderResolution,
} from "@langwatch/model-provider-contract";
import type {
  ModelDefaultRepository,
  ModelProviderCatalog,
} from "../ports/model-provider.port";
import type { ModelProviderScopeService } from "./model-provider-scope.service";

type ResolutionOptions = {
  defaults: ModelDefaultRepository;
  catalog: ModelProviderCatalog;
  scopes: ModelProviderScopeService;
};

const TIERS = [
  { type: "PROJECT" as const, label: "project" as const },
  { type: "TEAM" as const, label: "team" as const },
  { type: "ORGANIZATION" as const, label: "organization" as const },
];

export class ModelProviderResolutionService {
  private constructor(private readonly options: ResolutionOptions) {}

  static create(options: ResolutionOptions): ModelProviderResolutionService {
    return new ModelProviderResolutionService(options);
  }

  async resolve(input: ModelDefaultResolveInput): Promise<ModelProviderResolution> {
    const parsed = modelDefaultResolveInputSchema.parse({
      projectId: input.projectId,
      featureKey: input.featureKey,
    });
    const feature = this.feature(parsed.featureKey);
    const context = await this.options.scopes.getProjectContext(parsed.projectId);
    const configs = await this.configs(parsed.projectId, context.organizationId);
    const chain = this.chain(parsed.projectId, context.teamId, context.organizationId);
    const restrictedModels = new Set<string>();
    const resolution = this.findResolution(configs, chain, feature, restrictedModels);
    if (resolution) {
      return modelProviderResolutionSchema.parse({ ...resolution, feature });
    }
    if (parsed.featureKey === LANGY_CHAT_FEATURE_KEY) {
      return this.resolve({
        projectId: parsed.projectId,
        featureKey: "prompt.create_default",
      });
    }
    if (restrictedModels.size > 0) {
      throw new ModelRestrictedForFeatureError({
        featureKey: feature.key,
        role: feature.role,
        featureDisplayName: feature.displayName,
        projectId: parsed.projectId,
        restrictedModels: [...restrictedModels],
      });
    }
    throw new ModelNotConfiguredError(
      feature.key,
      feature.role,
      feature.displayName,
      parsed.projectId,
    );
  }

  async tryFindAlternate(input: {
    projectId: string;
    featureKey: string;
    skipFromScope: ModelProviderResolution["scope"];
  }): Promise<ModelProviderAlternateResolution | null> {
    const parsed = modelDefaultResolveInputSchema.parse({
      projectId: input.projectId,
      featureKey: input.featureKey,
    });
    const feature = this.options.catalog
      .defaultFeatures()
      .find((candidate) => candidate.key === parsed.featureKey);
    if (!feature) return null;
    const context = await this.options.scopes.getProjectContext(parsed.projectId);
    const configs = await this.configs(parsed.projectId, context.organizationId);
    const chain = this.chain(parsed.projectId, context.teamId, context.organizationId);
    const skipIndex = TIERS.findIndex((tier) => tier.label === input.skipFromScope);
    if (skipIndex < 0) return null;

    for (const tier of TIERS.slice(skipIndex + 1)) {
      const tierConfigs = this.tierConfigs(configs, chain, tier);
      for (const key of [feature.key, feature.role]) {
        for (const config of tierConfigs) {
          const value = readConfiguredModel(config.config[key]);
          if (!value) continue;
          const model = expandLatestAlias(value);
          if (isLatestAlias(value) && model === value) continue;
          return modelProviderResolutionSchema.parse({
            model,
            source: key === feature.key ? "feature_override" : "role_default",
            scope: tier.label,
            feature,
          });
        }
      }
    }
    return null;
  }

  private feature(featureKey: string): ModelDefaultFeature {
    const feature = this.options.catalog
      .defaultFeatures()
      .find((candidate) => candidate.key === featureKey);
    if (!feature) {
      throw new ModelProviderInvalidError(`Unknown feature key: "${featureKey}".`);
    }
    return feature;
  }

  private async configs(projectId: string, organizationId: string | null) {
    if (organizationId) return this.options.defaults.listForOrganization(organizationId);
    const scopes = await this.options.scopes.getProjectScopes(projectId);
    return this.options.defaults.listForProject(scopes);
  }

  private chain(
    projectId: string,
    teamId: string | null,
    organizationId: string | null,
  ): ModelDefaultScope[] {
    return [
      { scopeType: "PROJECT", scopeId: projectId },
      ...(teamId ? [{ scopeType: "TEAM" as const, scopeId: teamId }] : []),
      ...(organizationId
        ? [{ scopeType: "ORGANIZATION" as const, scopeId: organizationId }]
        : []),
    ];
  }

  private findResolution(
    configs: ModelDefaultConfig[],
    chain: ModelDefaultScope[],
    feature: ModelDefaultFeature,
    restrictedModels: Set<string>,
  ): Omit<ModelProviderResolution, "feature"> | null {
    for (const tier of TIERS) {
      const tierConfigs = this.tierConfigs(configs, chain, tier);
      for (const key of [feature.key, feature.role]) {
        for (const config of tierConfigs) {
          const value = readConfiguredModel(config.config[key]);
          if (!value) continue;
          const model = expandLatestAlias(value);
          if (isLatestAlias(value) && model === value) continue;
          if (!isModelAllowedForFeature({ modelId: model, featureKey: feature.key })) {
            restrictedModels.add(model);
            continue;
          }
          return {
            model,
            source: key === feature.key ? "feature_override" : "role_default",
            scope: tier.label,
          };
        }
      }
    }
    return null;
  }

  private tierConfigs(
    configs: ModelDefaultConfig[],
    chain: ModelDefaultScope[],
    tier: (typeof TIERS)[number],
  ): ModelDefaultConfig[] {
    return configs
      .filter((config) =>
        config.scopes.some(
          (scope) =>
            scope.scopeType === tier.type &&
            chain.some(
              (candidate) =>
                candidate.scopeType === scope.scopeType &&
                candidate.scopeId === scope.scopeId,
            ),
        ),
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }
}

function readConfiguredModel(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
