import {
  CODING_ASSISTANT_SURFACES_ONLY_NEEDLE,
  ModelDefaultValidationError,
  allFeatures,
  buildProviderOnboardingDefaultPlan,
  expandLatestAlias,
  featureByKey,
  getProviderModelOptions,
  getStaticModelCostRates,
  isLatestAlias,
  isModelAllowedAsRoleDefault,
  isModelAllowedForFeature,
  isModelRole,
  normalizeRoutingHandle,
  providerDeprecation,
  routingHandleProblem,
  tryGetModelProviderDefinition,
  type ModelCost,
  type ModelCostRate,
  type ModelDefaultConfig,
  type ModelDefaultScope,
  type ModelProvider,
  type ModelProviderApiKeyValidation,
  type ModelProviderCredentialVerdict,
  type CodexTokenKeys,
  type ModelProviderSummary,
  type ModelDefaultFeature,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import type { ProjectWithTeam } from "@langwatch/project-contract";
import type { LanguageModel } from "ai";
export type ModelProviderRecord = ModelProvider;
export type ModelDefaultConfigSaveInput = {
  id: string;
  organizationId: string;
  config: Record<string, string>;
  scopes: ModelDefaultScope[];
  authorId: string | null;
  createdAt?: Date;
};
export type ModelCostRecord = ModelCost;

/** Persistence owned by Model Provider. No caller receives this repository. */
export abstract class ModelProviderRepository {
  abstract tryFindById(input: {
    id: string;
    organizationId?: string;
    projectScopes?: ModelDefaultScope[];
  }): Promise<ModelProvider | null>;
  abstract tryFindByProviderForProject(input: {
    provider: string;
    projectScopes: ModelDefaultScope[];
  }): Promise<ModelProvider | null>;
  abstract listForProject(projectScopes: ModelDefaultScope[]): Promise<ModelProvider[]>;
  abstract listForOrganization(organizationId: string): Promise<ModelProvider[]>;
  abstract create(input: ModelProviderRecord): Promise<ModelProvider>;
  abstract update(input: ModelProviderRecord): Promise<ModelProvider>;
  abstract delete(input: {
    id: string;
    organizationId?: string;
    projectId?: string;
  }): Promise<void>;
  abstract hasStoredCredentials(id: string): Promise<boolean>;
  isRoutingHandleConflict(_error: unknown): boolean {
    return false;
  }
}

/** Credential encoding is supplied by the application boundary. */
export abstract class ModelProviderCredentialCodec {
  abstract encode(value: Record<string, unknown> | null): unknown;
  abstract tryDecode(value: unknown): Record<string, unknown> | null;
}

/**
 * Provider-specific credential rules. Encryption belongs to the codec above;
 * this policy validates writes, preserves masked values, and redacts reads.
 */
export abstract class ModelProviderCredentialPolicy {
  abstract tryNormalize(
    provider: string,
    value: Record<string, unknown> | null,
  ): Record<string, unknown> | null;
  abstract merge(input: {
    incoming: Record<string, unknown> | null;
    stored: Record<string, unknown> | null;
  }): Record<string, unknown>;
  abstract tryMask(value: Record<string, unknown> | null): Record<string, unknown> | null;
  abstract hasUsableReplacement(value: Record<string, unknown> | null): boolean;
  abstract assertCredentialsCanBeSaved(input: {
    provider: string;
    incoming: Record<string, unknown> | null;
    stored: Record<string, unknown> | null;
    storedCredentialsUnreadable: boolean;
  }): void;
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
  }): Promise<{ status: "refreshed"; tokens: CodexTokenKeys } | { status: "session_expired" }>;
}

export abstract class ModelProviderConnectionRateLimiter {
  abstract assertAvailable(input: { organizationId: string }): Promise<void>;
}

export abstract class ModelDefaultRepository {
  abstract listForProject(projectScopes: ModelDefaultScope[]): Promise<ModelDefaultConfig[]>;
  abstract tryGetById(id: string): Promise<ModelDefaultConfig | null>;
  abstract tryFindByScope(scope: ModelDefaultScope): Promise<ModelDefaultConfig | null>;
  abstract save(input: ModelDefaultConfigSaveInput): Promise<ModelDefaultConfig>;
  abstract set(input: {
    id: string;
    organizationId: string;
    scope: ModelDefaultScope;
    key: string;
    model: string | null;
    authorId: string | null;
  }): Promise<void>;
  abstract delete(id: string): Promise<void>;
  abstract listForOrganization(organizationId: string): Promise<ModelDefaultConfig[]>;
}

export abstract class ModelCostRepository {
  abstract listForProject(projectScopes: ModelDefaultScope[]): Promise<ModelCost[]>;
  abstract tryFindById(id: string): Promise<ModelCost | null>;
  abstract save(input: ModelCostRecord): Promise<ModelCost>;
  abstract delete(id: string): Promise<void>;
}

/** Registry/SDK boundary. Provider SDKs and environment configuration stay behind this port. */
export abstract class ModelProviderCatalog {
  exists(provider: string): boolean {
    return tryGetModelProviderDefinition(provider) !== null;
  }
  abstract systemProviders(input: {
    projectId?: string;
    organizationId?: string;
    referenceCreatedAt: Date;
  }): Promise<ModelProviderSummary[]>;
  abstract validateApiKey(
    provider: string,
    customKeys: Record<string, unknown>,
  ): Promise<ModelProviderApiKeyValidation>;
  /**
   * Probes a stored credential and reports which of the three verdicts it is.
   *
   * Abstract rather than derived from `validateApiKey`, which is the shape
   * this port used to carry: that default read `valid` off the save-time
   * verdict and returned `{ connected }`, so "we could not check this" — the
   * answer six of the sixteen registered providers give — arrived at the
   * browser as a pass. A catalog has to answer the question it was asked, and
   * the compiler now says so.
   */
  abstract testConnection(
    provider: string,
    customKeys: Record<string, unknown>,
  ): Promise<ModelProviderCredentialVerdict>;
  metadata(provider: string): {
    models: string[];
    embeddingsModels: string[];
    disabledByDefault?: boolean;
  } {
    const definition = tryGetModelProviderDefinition(provider);

    return {
      models: getProviderModelOptions(provider, "chat").map((model) => model.value),
      embeddingsModels: getProviderModelOptions(provider, "embedding").map((model) => model.value),
      disabledByDefault: definition?.type === "safety",
    };
  }
  defaultFeatures(): ModelDefaultFeature[] {
    return allFeatures().map(({ key, role, displayName, description }) => ({
      key,
      role,
      displayName,
      description,
    }));
  }
  /** Expand aliases and reject models that are not valid for a feature/role. */
  tryNormalizeDefaultModel(input: { key: string; model: string }): string | null {
    const model = expandLatestAlias(input.model);
    if (isLatestAlias(input.model) && model === input.model) {
      return null;
    }

    const allowed = isModelRole(input.key)
      ? isModelAllowedAsRoleDefault(model, input.key)
      : Boolean(
          featureByKey(input.key) &&
          isModelAllowedForFeature({ modelId: model, featureKey: input.key }),
        );

    return allowed ? model : null;
  }
  /** Optional onboarding suggestion used when no configured default exists. */
  inferredDefaultsForProvider(provider: string): Record<string, string> {
    const plan = buildProviderOnboardingDefaultPlan(provider);
    return Object.fromEntries(
      Object.entries(plan).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }
  /** Immutable platform registry rates; custom overrides are span attributes. */
  staticCostRates(): readonly ModelCostRate[] {
    return getStaticModelCostRates();
  }
  sanitizeDefaultConfig(input: Record<string, unknown>): Record<string, string> {
    const valid = new Set<string>([
      "DEFAULT",
      "FAST",
      "LANGY",
      "EMBEDDINGS",
      ...allFeatures().map((feature) => feature.key),
    ]);
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(input)) {
      if (!valid.has(key) || typeof value !== "string" || value.length === 0) {
        continue;
      }

      const allowed = isModelRole(key)
        ? isModelAllowedAsRoleDefault(value, key)
        : Boolean(
            featureByKey(key) && isModelAllowedForFeature({ modelId: value, featureKey: key }),
          );
      if (!allowed) {
        throw new ModelDefaultValidationError(
          `"${value}" ${CODING_ASSISTANT_SURFACES_ONLY_NEEDLE} and cannot be set for "${key}".`,
        );
      }

      clean[key] = value;
    }

    return clean;
  }
  tryNormalizeRoutingHandle(input: string | null): string | null {
    return normalizeRoutingHandle(input);
  }
  tryGetRoutingHandleProblem(handle: string | null): "shape" | "reserved" | null {
    return routingHandleProblem(handle);
  }
  tryGetProviderDeprecation(provider: string): { replacement?: string } | null {
    const deprecation = providerDeprecation(provider);
    return deprecation ? { replacement: deprecation.replacedBy } : null;
  }
  isManagedProvider(_input: { organizationId: string; provider: string }): boolean {
    return false;
  }
  prepareExecution(input: {
    parameters: Record<string, string>;
    projectId: string;
    model: string;
    provider: string;
  }): Promise<Record<string, string>> {
    return Promise.resolve(input.parameters);
  }
  /**
   * Reads a provider execution value from its stored credentials or injected
   * process configuration. The package never reaches into environment state.
   */
  abstract tryGetExecutionValue(input: {
    customKeys: Record<string, unknown> | null;
    key: string;
  }): string | null;
  tryGetStoredExecutionValue(input: {
    customKeys: Record<string, unknown> | null;
    key: string;
  }): string | null {
    const value = input.customKeys?.[input.key];
    return typeof value === "string" && value.length > 0 ? value : null;
  }
  tryGetExecutionDefinition(input: {
    provider: string;
  }): { apiKey: string; endpointKey: string | null } | null {
    const definition = tryGetModelProviderDefinition(input.provider);
    return definition
      ? {
          apiKey: definition.apiKey,
          endpointKey: definition.endpointKey ?? null,
        }
      : null;
  }
}

export abstract class ModelTranslationPort {
  abstract translate(input: {
    projectId: string;
    text: string;
    model: string;
    modelProviders: ModelProviderService;
  }): Promise<string>;
}

/** Generates identifiers for records owned by Model Provider. */
export abstract class ModelProviderIdService {
  abstract generate(input: { type: "provider" | "default" | "cost" }): string;
}

/**
 * The project read the scope facts are derived from.
 *
 * Model Provider scopes a cost, a default and a credential to a project, its
 * team and its organization, and all three ids are on the project row read
 * with its team. That one read is the only thing the derivation needs, so it
 * is named here rather than taken as a whole `ProjectService` — which would
 * put the project write graph, an organization service and an authz service in
 * a process that only prices a span. `ProjectService` and
 * `ProjectMetadataService` both satisfy this.
 */
export abstract class ModelCostProjectPort {
  abstract tryGetWithTeam(id: string): Promise<ProjectWithTeam | null>;
  abstract getWithTeam(id: string): Promise<ProjectWithTeam>;
}

/**
 * The scope derivation the cost listing asks for.
 *
 * `ModelProviderProjectScopeService` answers it, and so does the wider
 * `ModelProviderScopeService` that composes it.
 */
export abstract class ModelCostProjectScopePort {
  abstract tryGetProjectScopes(projectId: string): Promise<ModelDefaultScope[] | null>;
}

/**
 * Whether a project can see any provider that is attached and switched on.
 *
 * Its own port rather than a method on {@link ModelProviderRepository}, and the
 * distinction is the credential. Every read on that repository maps a row, and
 * mapping a row decodes `customKeys` through the codec it was built with — so a
 * caller that only wants a boolean would have to be handed a decrypting reader
 * to get one. This one selects an id and cannot decode anything, which is what
 * lets the setup checklist ask the question without holding the deployment's
 * cipher.
 */
export abstract class ModelProviderEvidenceRepository {
  abstract hasEnabledForScopes(projectScopes: ModelDefaultScope[]): Promise<boolean>;
}

/**
 * The at-rest cipher a stored credential is written and read through.
 *
 * A port rather than an implementation because the KEY is the deployment's:
 * every process reads its own `CREDENTIALS_SECRET` and hands the cipher in,
 * and a package that named the variable would decide for all of them. The
 * format itself is a WIRE FORMAT — rows written by one process are read by
 * another — so the cipher passed here must be the deployment's one cipher and
 * not a second implementation of it.
 */
export abstract class ModelProviderCredentialCipherPort {
  abstract encrypt(value: string): string;
  abstract decrypt(value: string): string;
}

/** One outbound probe's answer, as the credential prober reads it. */
export type ModelProviderEgressResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

/** What one credential probe asks of the network. */
export type ModelProviderEgressRequest = {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
};

/**
 * The guarded way out of the process, for the credential probe.
 *
 * Every probe carries a customer's credential to a URL a customer chose, so it
 * may not go through bare `fetch`: the composition root supplies an
 * SSRF-validated, IP-pinned, redirect-refusing egress and this package never
 * learns which one. `isRedirectRefusal` is on the port for the same reason the
 * prober matches by type rather than by message — a refused hop is a different
 * answer to the customer than a host that never replied, and only the
 * implementation knows which error class it raises.
 */
export abstract class ModelProviderEgressPort {
  abstract fetch(
    url: string,
    request: ModelProviderEgressRequest,
  ): Promise<ModelProviderEgressResponse>;
  abstract isRedirectRefusal(error: unknown): boolean;
}

/**
 * The stored-credential probe itself.
 *
 * Separated from {@link ModelProviderCatalog} because it is the one catalogue
 * answer that leaves the process: a deployment with no egress of its own can
 * compose every other catalogue answer and refuse this one by name, rather
 * than reporting an unchecked credential as a working one.
 */
export abstract class ModelProviderCredentialProbePort {
  abstract probe(input: {
    provider: string;
    customKeys: Record<string, string>;
  }): Promise<ModelProviderCredentialVerdict>;
}

/** One fixed window, counted wherever the process counts its windows. */
export abstract class ModelProviderRateLimitPort {
  abstract consume(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<{ allowed: boolean; resetAt: number }>;
}

/**
 * Whether LangWatch itself supplies a provider's credentials, and with what.
 *
 * The managed-provider vertical is Enterprise and this package is not, so the
 * two methods it actually needs are named here and the composition root
 * adapts its Enterprise service onto them. Absent, every provider is the
 * customer's own — which is the true answer for every deployment that has no
 * managed providers, and the WRONG one for a deployment that does, so a
 * composition root that has the service must pass it.
 */
export abstract class ModelProviderManagedGatewayPort {
  abstract isManaged(input: { organizationId: string; provider: string }): boolean;
  abstract prepareParameters(input: {
    parameters: Record<string, string>;
    projectId: string;
    model: string;
    provider: string;
  }): Promise<Record<string, string>>;
}

/**
 * The handle a Codex model executes through.
 *
 * Codex has exactly one road — the AI gateway's Responses endpoint, on the
 * per-project virtual key the Langy agent uses — so resolving one needs the
 * gateway vertical, which is not this feature's. A process that composes no
 * gateway credential passes nothing and the cascade refuses codex models by
 * name; every other provider is unaffected.
 */
export abstract class ModelProviderCodexHandlePort {
  abstract resolve(input: {
    projectId: string;
    model: string;
    featureKey: string;
  }): Promise<LanguageModel>;
}
