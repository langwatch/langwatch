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
  classifyRoutingHandleProblem,
  findModelProviderDefinition,
  type ModelCostRate,
  type ModelDefaultScope,
  type ModelProviderApiKeyValidation,
  type ModelProviderCredentialVerdict,
  type CodexTokenKeys,
  type ModelProviderSummary,
  type ModelDefaultFeature,
  type ModelProviderApi,
} from "@langwatch/model-provider-contract";
import type { ProjectWithTeam } from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";
import type { LanguageModel } from "ai";

/** How a ModelProvider's `customKeys` column read back. */
export interface CustomKeysRead {
  state: "absent" | "read" | "unreadable";
  keys: Record<string, unknown>;
}

/** Credential encoding is supplied by the application boundary. */
export abstract class ModelProviderCredentialCodec {
  abstract encode(value: Record<string, unknown> | null): unknown;
  abstract decode(value: unknown): CustomKeysRead;
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
    incoming: { key: string; value: string }[];
    stored: { key: string; value: string }[];
  }): { key: string; value: string }[];
  abstract maskHeaders(value: { key: string; value: string }[]): { key: string; value: string }[];
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

/** Registry/SDK boundary. Provider SDKs and environment configuration stay behind this port. */
export abstract class ModelProviderCatalog {
  exists(provider: string): boolean {
    return findModelProviderDefinition(provider) !== null;
  }
  abstract systemProviders(input: {
    projectId?: string;
    organizationId?: string;
    referenceCreatedAt: Instant;
  }): Promise<ModelProviderSummary[]>;
  abstract validateApiKey(
    provider: string,
    customKeys: Record<string, unknown>,
  ): Promise<ModelProviderApiKeyValidation>;
  /**
   * Probes a stored credential and reports which of the three verdicts it is. Abstract rather
   * than derived from `validateApiKey`, whose default let "could not check" arrive as a pass.
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
    const definition = findModelProviderDefinition(provider);

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
  normalizeDefaultModel(input: { key: string; model: string }): string | null {
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
  normalizeRoutingHandle(input: string | null): string | null {
    return normalizeRoutingHandle(input);
  }
  classifyRoutingHandleProblem(handle: string | null): "shape" | "reserved" | null {
    return classifyRoutingHandleProblem(handle);
  }
  pickProviderDeprecation(provider: string): { replacement?: string } | null {
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
  pickStoredExecutionValue(input: {
    customKeys: Record<string, unknown> | null;
    key: string;
  }): string | null {
    const value = input.customKeys?.[input.key];
    return typeof value === "string" && value.length > 0 ? value : null;
  }
  pickExecutionDefinition(input: {
    provider: string;
  }): { apiKey: string; endpointKey: string | null } | null {
    const definition = findModelProviderDefinition(input.provider);
    return definition
      ? {
          apiKey: definition.apiKey,
          endpointKey: definition.endpointKey ?? null,
        }
      : null;
  }
}

export abstract class ModelTranslation {
  abstract translate(input: {
    projectId: string;
    text: string;
    model: string;
    modelProviders: Pick<
      ModelProviderApi,
      "resolveModelForFeature" | "findAlternateModel" | "getExecutionProviders"
    >;
  }): Promise<string>;
}

/** Generates identifiers for records owned by Model Provider. */
export abstract class ModelProviderIdService {
  abstract generate(input: { type: "provider" | "default" | "cost" }): string;
}

/**
 * The project read the scope facts are derived from, named narrowly rather than a whole
 * `ProjectApi` so a process that only prices a span doesn't also compose an authz service.
 */
export abstract class ModelCostProject {
  abstract findWithTeam(id: string): Promise<ProjectWithTeam | null>;
  abstract getWithTeam(id: string): Promise<ProjectWithTeam>;
}

/**
 * The scope derivation the cost listing asks for — answered by both
 * `ModelProviderProjectScopeService` and the wider `ModelProviderScopeService`
 * that composes it.
 */
export abstract class ModelCostProjectScope {
  abstract getProjectScopes(projectId: string): Promise<ModelDefaultScope[]>;
}

/**
 * The at-rest cipher a stored credential is written and read through. A port, not an
 * implementation: the key is the deployment's own `CREDENTIALS_SECRET`, and rows written by
 * one process are read by another, so every process must share this one cipher.
 */
export abstract class ModelProviderCredentialCipher {
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
 * The guarded way out of the process, for the credential probe: bare `fetch` is refused since a
 * customer's credential goes to a customer-chosen URL. `isRedirectRefusal` matches by error type
 * because only the implementation knows which class a refused hop raises, not the message.
 */
export abstract class ModelProviderEgress {
  abstract fetch(
    url: string,
    request: ModelProviderEgressRequest,
  ): Promise<ModelProviderEgressResponse>;
  abstract isRedirectRefusal(error: unknown): boolean;
}

/**
 * The stored-credential probe, separated from {@link ModelProviderCatalog}
 * because it's the one answer that leaves the process: a deployment with no
 * egress can refuse it by name, rather than reporting an unchecked credential as working.
 */
export abstract class ModelProviderCredentialProbe {
  abstract probe(input: {
    provider: string;
    customKeys: Record<string, string>;
  }): Promise<ModelProviderCredentialVerdict>;
  /**
   * The stored (or this deployment's own environment) credential, probed
   * against a caller-overridable base URL. The gateway is passed in, not
   * held: which rows this probe reads is the application's, not the fence's.
   */
  abstract probeStored(input: {
    projectId: string;
    provider: string;
    customBaseUrl: string | undefined;
    modelProviders: Pick<ModelProviderApi, "findProviderForProject">;
  }): Promise<ModelProviderCredentialVerdict>;
}

/** One fixed window, counted wherever the process counts its windows. */
export abstract class ModelProviderRateLimit {
  abstract consume(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<{ allowed: boolean; resetAt: number }>;
}

/**
 * Whether LangWatch itself supplies a provider's credentials, and with what. The managed-provider
 * vertical is Enterprise and this package is not, so a composition root that has that service
 * must pass it — absent, every provider reads as the customer's own, wrong for one that isn't.
 */
export abstract class ModelProviderManagedGateway {
  abstract isManaged(input: { organizationId: string; provider: string }): boolean;
  abstract prepareParameters(input: {
    parameters: Record<string, string>;
    projectId: string;
    model: string;
    provider: string;
  }): Promise<Record<string, string>>;
}

/**
 * The handle a Codex model executes through, via the AI gateway's Responses endpoint — not this
 * feature's vertical, so a process with no gateway credential passes nothing and the cascade
 * refuses codex models by name; every other provider is unaffected.
 */
export abstract class ModelProviderCodexHandle {
  abstract resolve(input: {
    projectId: string;
    model: string;
    featureKey: string;
  }): Promise<LanguageModel>;
}
