import {
  ModelProviderInvalidError,
  modelDefaultResolveInputSchema,
  modelDefaultSnapshotInputSchema,
  modelDefaultSnapshotSchema,
  type ModelDefaultConfig,
  type ModelDefaultEffective,
  type ModelDefaultInheritedValues,
  type ModelDefaultResolveInput,
  type ModelDefaultScope,
  type ModelDefaultSnapshot,
  type ModelDefaultSnapshotInput,
} from "@langwatch/model-provider-contract";
import type {
  ModelDefaultRepository,
  ModelProviderCatalog,
  ModelProviderRepository,
} from "../ports/model-provider.port";
import { ModelProviderAuthorizationService } from "./model-provider-authorization.service";
import type { ModelProviderScopeService } from "./model-provider-scope.service";

type DefaultScope = { id: string; name: string };
type DefaultProjectScope = DefaultScope & { teamId: string };
type DefaultAvailableScopes = {
  organization: DefaultScope | null;
  teams: DefaultScope[];
  projects: DefaultProjectScope[];
};
type ModelProviderDefaultsOptions = {
  defaults: ModelDefaultRepository;
  providers: ModelProviderRepository;
  catalog: ModelProviderCatalog;
  authorization: ModelProviderAuthorizationService;
  scopes: ModelProviderScopeService;
};

export class ModelProviderDefaultsService {
  private constructor(private readonly options: ModelProviderDefaultsOptions) {}

  static create(options: ModelProviderDefaultsOptions): ModelProviderDefaultsService {
    return new ModelProviderDefaultsService(options);
  }

  async getSnapshot(input: ModelDefaultSnapshotInput): Promise<ModelDefaultSnapshot> {
    const parsed = modelDefaultSnapshotInputSchema.parse(input);
    const context = await this.options.scopes.getProjectContext(parsed.projectId);
    const configs = await this.getConfigs(parsed.projectId, context.organizationId);
    const visible = await this.visibleConfigs(configs, parsed.actorId);
    const available = await this.getAvailableScopes({
      projectId: parsed.projectId,
      teamId: context.teamId,
      organizationId: context.organizationId,
    });
    const effective = this.resolveEffective({
      configs: visible,
      chain: this.projectChain({
        projectId: parsed.projectId,
        teamId: context.teamId,
        organizationId: context.organizationId,
      }),
    });
    const writable = await this.writableScopes(available, parsed.actorId);
    const names = this.scopeNames(available);

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
    scopes: ModelDefaultScope[];
    excludeConfigId?: string;
  }): Promise<ModelDefaultInheritedValues> {
    const context = await this.options.scopes.getProjectContext(input.projectId);
    const reference = firstScope(input.scopes);
    const available = await this.getAvailableScopes({
      projectId: input.projectId,
      teamId: context.teamId,
      organizationId: context.organizationId,
    });
    this.assertScopesBelongToProject(input.scopes, available, context.organizationId);

    const chain = inheritedChain({
      reference,
      available,
      organizationId: context.organizationId,
    });
    const excluded = new Set(input.scopes.map((scope) => `${scope.scopeType}:${scope.scopeId}`));
    const tiers = chain.filter((scope) => !excluded.has(`${scope.scopeType}:${scope.scopeId}`));
    const configs = (await this.getConfigs(input.projectId, context.organizationId)).filter(
      (config) => config.id !== input.excludeConfigId,
    );
    const inherited = await this.resolveInherited({
      projectId: input.projectId,
      configs,
      tiers,
    });

    return { inherited, referenceScope: reference };
  }

  async tryGetResolved(input: ModelDefaultResolveInput): Promise<ModelDefaultEffective | null> {
    const parsed = modelDefaultResolveInputSchema.parse({
      projectId: input.projectId,
      featureKey: input.featureKey,
    });
    const snapshot = await this.getSnapshot({ projectId: parsed.projectId });
    const direct = snapshot.effective[parsed.featureKey];
    if (direct) {
      return direct;
    }

    const feature = this.options.catalog
      .defaultFeatures()
      .find((candidate) => candidate.key === parsed.featureKey);
    const roleDefault = feature ? (snapshot.effective[feature.role] ?? null) : null;
    if (roleDefault) {
      return roleDefault;
    }

    return parsed.featureKey === "langy.chat"
      ? (snapshot.effective["prompt.create_default"] ?? null)
      : null;
  }

  /** Every scope the caller can reach, by id, for labelling a snapshot. */
  private scopeNames(available: {
    organization: { id: string; name: string } | null;
    teams: Array<{ id: string; name: string }>;
    projects: Array<{ id: string; name: string }>;
  }): Map<string, string> {
    return new Map([
      ...(available.organization
        ? [[available.organization.id, available.organization.name] as const]
        : []),
      ...available.teams.map((scope) => [scope.id, scope.name] as const),
      ...available.projects.map((scope) => [scope.id, scope.name] as const),
    ]);
  }

  private async visibleConfigs(
    configs: ModelDefaultConfig[],
    actorId?: string,
  ): Promise<ModelDefaultConfig[]> {
    if (!actorId) {
      return configs;
    }

    const visible = await Promise.all(
      configs.map(async (config) => {
        const scopes = await filterScopes(config.scopes, (scope) =>
          this.options.authorization.canRead(actorId, scope),
        );

        return { ...config, scopes };
      }),
    );

    return visible.filter((config) => config.scopes.length > 0);
  }

  private resolveEffective(input: {
    configs: ModelDefaultConfig[];
    chain: ModelDefaultScope[];
  }): Record<string, ModelDefaultEffective | null> {
    const features = this.options.catalog.defaultFeatures();
    const roles = new Set([
      "DEFAULT",
      "FAST",
      "LANGY",
      "EMBEDDINGS",
      ...features.map((feature) => feature.role),
    ]);
    const effective: Record<string, ModelDefaultEffective | null> = {};
    for (const role of roles) {
      const feature = features.find((candidate) => candidate.role === role);
      effective[role] = this.resolveConfigured(
        input.configs,
        input.chain,
        feature?.key ?? role,
        role,
      );
    }
    for (const feature of features) {
      effective[feature.key] = this.resolveConfigured(
        input.configs,
        input.chain,
        feature.key,
        feature.role,
      );
    }

    return effective;
  }

  private async resolveInherited(input: {
    projectId: string;
    configs: ModelDefaultConfig[];
    tiers: ModelDefaultScope[];
  }): Promise<ModelDefaultInheritedValues["inherited"]> {
    const features = this.options.catalog.defaultFeatures();
    const keys = [
      "DEFAULT",
      "FAST",
      "LANGY",
      "EMBEDDINGS",
      ...features.map((feature) => feature.key),
    ];
    const inherited: ModelDefaultInheritedValues["inherited"] = {};
    for (const key of keys) {
      const role = features.find((feature) => feature.key === key)?.role ?? key;
      const configured = this.resolveConfigured(input.configs, input.tiers, key, role, false);
      inherited[key] = configured ?? (await this.inferDefault(input.projectId, key));
    }
    for (const feature of features) {
      inherited[feature.key] = inherited[feature.key] ?? inherited[feature.role] ?? null;
    }

    return inherited;
  }

  private async inferDefault(
    projectId: string,
    key: string,
  ): Promise<ModelDefaultEffective | null> {
    if (key.includes(".")) {
      return null;
    }

    const projectScopes = await this.options.scopes.getProjectScopes(projectId);
    const providers = await this.options.providers.listForProject(projectScopes);
    const provider = providers
      .filter((candidate) => candidate.enabled)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];
    const configured = provider
      ? this.options.catalog.inferredDefaultsForProvider(provider.provider)[key]
      : undefined;
    if (!configured) {
      return null;
    }

    return {
      model: this.normalizeModel(key, configured) ?? configured,
      source: "inferred",
      scope: null,
      inferredFromProvider: provider?.provider,
    };
  }

  private resolveConfigured(
    configs: ModelDefaultConfig[],
    chain: ModelDefaultScope[],
    key: string,
    role: string,
    expandModel = true,
  ): ModelDefaultEffective | null {
    for (const tier of DEFAULT_TIERS) {
      const configured = this.findConfigured(configs, chain, key, tier, expandModel);
      if (configured) {
        return configured;
      }

      if (role !== key) {
        const fallback = this.findConfigured(configs, chain, role, tier, expandModel);
        if (fallback) {
          return fallback;
        }
      }
    }

    return null;
  }

  private findConfigured(
    configs: ModelDefaultConfig[],
    chain: ModelDefaultScope[],
    key: string,
    tier: (typeof DEFAULT_TIERS)[number],
    expandModel: boolean,
  ): ModelDefaultEffective | null {
    const scopeIds = new Set(
      chain.filter((scope) => scope.scopeType === tier.type).map((scope) => scope.scopeId),
    );
    if (scopeIds.size === 0) {
      return null;
    }

    const configsAtTier = configs
      .filter((config) =>
        config.scopes.some((scope) => scope.scopeType === tier.type && scopeIds.has(scope.scopeId)),
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    for (const config of configsAtTier) {
      const raw = config.config[key];
      if (!raw) {
        continue;
      }

      const model = expandModel ? this.normalizeModel(key, raw) : raw;
      if (!model) {
        continue;
      }

      return {
        model,
        source: key.includes(".") ? "feature_override" : "role_default",
        scope: tier.label,
      };
    }

    return null;
  }

  private normalizeModel(key: string, model: string): string | null {
    return this.options.catalog.tryNormalizeDefaultModel({ key, model });
  }

  private async getConfigs(
    projectId: string,
    organizationId: string | null,
  ): Promise<ModelDefaultConfig[]> {
    if (organizationId) {
      return this.options.defaults.listForOrganization(organizationId);
    }

    const projectScopes = await this.options.scopes.getProjectScopes(projectId);
    return this.options.defaults.listForProject(projectScopes);
  }

  private async getAvailableScopes(input: {
    projectId: string;
    teamId: string | null;
    organizationId: string | null;
  }): Promise<DefaultAvailableScopes> {
    if (input.organizationId) {
      return this.options.scopes.listAvailableScopes(input.organizationId);
    }

    return {
      organization: null,
      teams: [],
      projects: [
        {
          id: input.projectId,
          name: input.projectId,
          teamId: input.teamId ?? "",
        },
      ],
    };
  }

  private async writableScopes(
    available: DefaultAvailableScopes,
    actorId?: string,
  ): Promise<DefaultAvailableScopes> {
    const authorization = this.options.authorization;
    if (!actorId) {
      return { organization: null, teams: [], projects: [] };
    }

    const organization = available.organization;
    const canWriteOrganization = organization
      ? await authorization.canWrite(actorId, {
          scopeType: "ORGANIZATION",
          scopeId: organization.id,
        })
      : false;
    const teams = await filterScopes(available.teams, (scope) =>
      authorization.canWrite(actorId, { scopeType: "TEAM", scopeId: scope.id }),
    );
    const projects = await filterScopes(available.projects, (scope) =>
      authorization.canWrite(actorId, { scopeType: "PROJECT", scopeId: scope.id }),
    );

    return {
      organization: canWriteOrganization ? organization : null,
      teams,
      projects,
    };
  }

  private assertScopesBelongToProject(
    scopes: ModelDefaultScope[],
    available: DefaultAvailableScopes,
    organizationId: string | null,
  ): void {
    const valid = scopes.every((scope) => {
      if (scope.scopeType === "ORGANIZATION") {
        return scope.scopeId === organizationId;
      }
      if (scope.scopeType === "TEAM") {
        return available.teams.some((team) => team.id === scope.scopeId);
      }

      return available.projects.some((project) => project.id === scope.scopeId);
    });
    if (!valid) {
      throw new ModelProviderInvalidError(
        "Default scope does not belong to the project organization",
      );
    }
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
}

const DEFAULT_TIERS = [
  { type: "PROJECT" as const, label: "project" as const },
  { type: "TEAM" as const, label: "team" as const },
  { type: "ORGANIZATION" as const, label: "organization" as const },
];

function firstScope(scopes: ModelDefaultScope[]): ModelDefaultScope {
  const order = { PROJECT: 0, TEAM: 1, ORGANIZATION: 2 };
  const reference = [...scopes].sort(
    (left, right) => order[left.scopeType] - order[right.scopeType],
  )[0];
  if (!reference) {
    throw new ModelProviderInvalidError("At least one scope is required");
  }

  return reference;
}

function inheritedChain(input: {
  reference: ModelDefaultScope;
  available: DefaultAvailableScopes;
  organizationId: string | null;
}): ModelDefaultScope[] {
  const { reference, available, organizationId } = input;
  if (reference.scopeType === "ORGANIZATION") {
    return [reference];
  }

  const chain = [reference];
  if (reference.scopeType === "PROJECT") {
    const project = available.projects.find((candidate) => candidate.id === reference.scopeId);
    if (project?.teamId) {
      chain.push({ scopeType: "TEAM", scopeId: project.teamId });
    }
  }
  if (organizationId) {
    chain.push({ scopeType: "ORGANIZATION", scopeId: organizationId });
  }

  return chain;
}

async function filterScopes<T>(scopes: T[], canKeep: (scope: T) => Promise<boolean>): Promise<T[]> {
  const results = await Promise.all(
    scopes.map(async (scope) => ({ scope, keep: await canKeep(scope) })),
  );

  return results.filter(({ keep }) => keep).map(({ scope }) => scope);
}
