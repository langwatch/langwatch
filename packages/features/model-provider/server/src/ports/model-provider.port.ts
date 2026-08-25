import type {
  ModelCost,
  ModelCostRate,
  ModelDefaultConfig,
  ModelDefaultScope,
  ModelProvider,
  ModelProviderApiKeyValidation,
  CodexTokenKeys,
  ModelProviderSummary,
  ModelDefaultFeature,
  ModelProviderService,
} from "@langwatch/model-provider-contract";

export abstract class ModelProviderAuthorization {
  abstract canRead(input: {
    actorId: string;
    scopeType: ModelDefaultScope["scopeType"];
    scopeId: string;
  }): Promise<boolean>;
  abstract canWrite(input: {
    actorId: string;
    scopeType: ModelDefaultScope["scopeType"];
    scopeId: string;
  }): Promise<boolean>;
}

/** Persistence owned by Model Provider. No caller receives this repository. */
export abstract class ModelProviderRepository {
  abstract tryFindById(input: {
    id: string;
    organizationId?: string;
    projectId?: string;
  }): Promise<ModelProvider | null>;
  abstract tryFindByProviderForProject(input: {
    provider: string;
    projectId: string;
  }): Promise<ModelProvider | null>;
  abstract listForProject(projectId: string): Promise<ModelProvider[]>;
  abstract listForOrganization(organizationId: string): Promise<ModelProvider[]>;
  abstract create(
    input: Omit<ModelProvider, "createdAt" | "updatedAt">,
  ): Promise<ModelProvider>;
  abstract update(
    input: Omit<ModelProvider, "createdAt" | "updatedAt">,
  ): Promise<ModelProvider>;
  abstract delete(input: {
    id: string;
    organizationId?: string;
    projectId?: string;
  }): Promise<void>;
  abstract tryResolveOrganizationId(input: {
    projectId?: string;
    organizationId?: string;
  }): Promise<string | null>;
  abstract resolveOrganizationIdForScopes(scopes: ModelDefaultScope[]): Promise<string>;
  abstract hasStoredCredentials(id: string): Promise<boolean>;
}

/** Application-owned policy for the defaults created with a new provider. */
export abstract class ModelProviderOnboardingDefaults {
  abstract seed(input: { provider: string; scopes: ModelDefaultScope[] }): Promise<void>;
}

/** Credential encoding is supplied by the application boundary. */
export abstract class ModelProviderCredentialCodec {
  abstract encode(value: Record<string, unknown> | null): unknown;
  abstract decode(value: unknown): Record<string, unknown> | null;
}

/**
 * Provider-specific credential rules. Encryption belongs to the codec above;
 * this policy validates writes, preserves masked values, and redacts reads.
 */
export abstract class ModelProviderCredentialPolicy {
  abstract normalize(
    provider: string,
    value: Record<string, unknown> | null,
  ): Record<string, unknown> | null;
  abstract merge(input: {
    incoming: Record<string, unknown> | null;
    stored: Record<string, unknown> | null;
  }): Record<string, unknown>;
  abstract mask(value: Record<string, unknown> | null): Record<string, unknown> | null;
  abstract hasUsableReplacement(value: Record<string, unknown> | null): boolean;
  abstract mergeHeaders(input: {
    incoming: Array<{ key: string; value: string }>;
    stored: Array<{ key: string; value: string }>;
  }): Array<{ key: string; value: string }>;
  abstract maskHeaders(
    value: Array<{ key: string; value: string }>,
  ): Array<{ key: string; value: string }>;
}

/** OAuth exchange boundary owned by the application runtime. */
export abstract class CodexTokenRefresher {
  abstract refresh(input: {
    tokens: CodexTokenKeys;
  }): Promise<
    { status: "refreshed"; tokens: CodexTokenKeys } | { status: "session_expired" }
  >;
}

export abstract class ModelDefaultRepository {
  abstract listForProject(projectId: string): Promise<ModelDefaultConfig[]>;
  abstract tryGetById(id: string): Promise<ModelDefaultConfig | null>;
  abstract save(
    input: Omit<ModelDefaultConfig, "createdAt" | "updatedAt" | "organizationId"> & {
      createdAt?: Date;
    },
  ): Promise<ModelDefaultConfig>;
  abstract set(input: {
    scope: ModelDefaultScope;
    key: string;
    model: string | null;
    authorId: string | null;
  }): Promise<void>;
  abstract delete(id: string): Promise<void>;
  abstract tryResolve(input: {
    projectId: string;
    featureKey: string;
  }): Promise<string | null>;
  async getProjectContext(_projectId: string): Promise<{
    teamId: string | null;
    organizationId: string | null;
    organizationName: string | null;
  }> {
    throw new Error("Project was not found");
  }
  async listForOrganization(organizationId: string): Promise<ModelDefaultConfig[]> {
    return this.listForProject(organizationId);
  }
  async listOrganizationScopes(_organizationId: string): Promise<{
    organization: { id: string; name: string } | null;
    teams: { id: string; name: string }[];
    projects: { id: string; name: string; teamId: string }[];
  }> {
    return { organization: null, teams: [], projects: [] };
  }
}

export abstract class ModelCostRepository {
  abstract listForProject(projectId: string): Promise<ModelCost[]>;
  abstract tryFindById(id: string): Promise<ModelCost | null>;
  abstract save(
    input: Omit<ModelCost, "createdAt" | "updatedAt"> & { createdAt?: Date },
  ): Promise<ModelCost>;
  abstract delete(id: string): Promise<void>;
  abstract tryResolveOrganizationId(input: {
    projectId: string;
    scopeType?: ModelDefaultScope["scopeType"];
    scopeId?: string;
  }): Promise<string | null>;
}

/** Registry/SDK boundary. Provider SDKs and environment configuration stay behind this port. */
export abstract class ModelProviderCatalog {
  abstract exists(provider: string): boolean;
  abstract systemProviders(input: {
    projectId?: string;
    organizationId?: string;
  }): Promise<ModelProviderSummary[]>;
  abstract validateApiKey(
    provider: string,
    customKeys: Record<string, unknown>,
  ): Promise<ModelProviderApiKeyValidation>;
  abstract testConnection(
    provider: string,
    customKeys: Record<string, unknown>,
  ): Promise<{ connected: boolean }>;
  abstract tryMaskCredentials(
    customKeys: Record<string, unknown> | null,
  ): Record<string, unknown> | null;
  metadata(_provider: string): {
    models: string[];
    embeddingsModels: string[];
    disabledByDefault?: boolean;
  } {
    return { models: [], embeddingsModels: [] };
  }
  defaultFeatures(): ModelDefaultFeature[] {
    return [];
  }
  /** Expand aliases and reject models that are not valid for a feature/role. */
  tryNormalizeDefaultModel(_input: { key: string; model: string }): string | null {
    return _input.model;
  }
  /** Optional onboarding suggestion used when no configured default exists. */
  inferredDefaultsForProvider(_provider: string): Record<string, string> {
    return {};
  }
  /** Immutable platform registry rates; custom overrides are span attributes. */
  staticCostRates(): readonly ModelCostRate[] {
    return [];
  }
  sanitizeDefaultConfig(input: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(input).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].length > 0,
      ),
    );
  }
}

export abstract class ManagedProviderService {
  abstract isManagedProvider(organizationId: string, provider: string): boolean;
}

export abstract class ModelTranslationPort {
  abstract translate(input: {
    projectId: string;
    text: string;
    model: string;
    modelProviders: ModelProviderService;
  }): Promise<string>;
}

export type ModelProviderIdGenerator = () => string;
