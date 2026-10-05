import {
  allFeatures,
  buildProviderOnboardingDefaultPlan,
  classifyRoutingHandleProblem,
  CODING_ASSISTANT_SURFACES_ONLY_NEEDLE,
  expandLatestAlias,
  findFeatureByKey,
  findModelProviderDefinition,
  findProviderDeprecation,
  getProviderModelOptions,
  getStaticModelCostRates,
  isLatestAlias,
  isModelAllowedAsRoleDefault,
  isModelAllowedForFeature,
  isModelRole,
  ModelDefaultValidationError,
  modelProviders,
  normalizeRoutingHandle,
  type ModelCostRate,
  type ModelDefaultFeature,
  type ModelProviderApiKeyValidation,
  type ModelProviderCredentialVerdict,
  type ModelProviderSummary,
} from "@langwatch/model-provider-contract";
import { Temporal, toDate, type Instant } from "@langwatch/time";
import { z } from "zod";

import type { ModelProviderCredentialProbe } from "./http-model-provider-credential-probe.service.ts";
import type { ModelProviderManagedGateway } from "./managed-model-provider-gateway.service.ts";

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
          findFeatureByKey(input.key)[0] &&
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
            findFeatureByKey(key)[0] &&
            isModelAllowedForFeature({ modelId: value, featureKey: key }),
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
    const deprecation = findProviderDeprecation(provider)[0];
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
  abstract pickExecutionValue(input: {
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

const customKeysSchema = z.record(z.string(), z.string());

export type RegistryModelProviderCatalogOptions = {
  /**
   * Whether LangWatch supplies a provider's credentials, and with what. The
   * composition root adapts its Enterprise service onto this; a deployment
   * with none passes the unmanaged stand-in below.
   */
  managed: ModelProviderManagedGateway;
  /** Probes a credential against the provider itself. */
  probe: ModelProviderCredentialProbe;
  /**
   * The process configuration a SYSTEM provider's credential is read from.
   * Passed in whole rather than read here: which variables carry a key is
   * the registry's business, but whether this process has them is the deployment's.
   */
  systemProviderEnvironment: Readonly<Record<string, string | undefined>>;
  /**
   * Whether this deployment is the hosted one. System providers are only
   * ever enabled on it — a self-hosted install with `OPENAI_API_KEY` set
   * would otherwise find a provider it never configured switched on.
   */
  isSaas: boolean;
};

/**
 * The catalogue answered from the packaged provider registry and this process's own
 * configuration — the base class derives model lists and static rates; this adds the
 * deployment-specific answers (system credentials, resolved execution keys, managed status).
 */
export class RegistryModelProviderCatalogService extends ModelProviderCatalog {
  static create(options: RegistryModelProviderCatalogOptions): RegistryModelProviderCatalogService {
    return new RegistryModelProviderCatalogService(options);
  }

  private constructor(private readonly options: RegistryModelProviderCatalogOptions) {
    super();
  }

  systemProviders(input: {
    projectId?: string;
    organizationId?: string;
    referenceCreatedAt: Instant;
  }): Promise<ModelProviderSummary[]> {
    const now = toDate(Temporal.Instant.fromEpochMilliseconds(0));
    const organizationId = input.organizationId ?? `system:${input.projectId ?? "global"}`;
    return Promise.resolve(
      Object.entries(modelProviders)
        .filter(([, definition]) => definition.enabledSince)
        .map(([provider, definition]) => {
          const enabled =
            Temporal.Instant.compare(definition.enabledSince, input.referenceCreatedAt) < 0 &&
            this.isSystemProviderEnabled(provider, definition.apiKey);
          const models = getProviderModelOptions(provider, "chat").map((model) => model.value);
          const embeddingsModels = getProviderModelOptions(provider, "embedding").map(
            (model) => model.value,
          );
          return {
            id: `system_${provider}`,
            organizationId,
            provider,
            name: definition.name,
            enabled,
            routingHandle: null,
            scopes: [],
            customKeys: null,
            customModels: [],
            customEmbeddingsModels: [],
            extraHeaders: [],
            rateLimitRpm: null,
            rateLimitTpm: null,
            rateLimitRpd: null,
            fallbackPriorityGlobal: null,
            providerConfig: null,
            createdAt: now,
            updatedAt: now,
            models,
            embeddingsModels,
            disabledByDefault: !enabled,
            isSystem: true,
            embeddingsUnsupported: false,
          } satisfies ModelProviderSummary;
        }),
    );
  }

  private isSystemProviderEnabled(provider: string, apiKey: string): boolean {
    return (
      this.options.isSaas &&
      Boolean(this.options.systemProviderEnvironment[apiKey]) &&
      (provider !== "vertex_ai" || Boolean(this.options.systemProviderEnvironment.VERTEXAI_PROJECT))
    );
  }

  async validateApiKey(
    provider: string,
    customKeys: Record<string, unknown>,
  ): Promise<ModelProviderApiKeyValidation> {
    const result = await this.options.probe.probe({
      provider,
      customKeys: customKeysSchema.parse(customKeys),
    });
    return { valid: result.valid, message: result.valid ? undefined : result.outcome };
  }

  /**
   * The stored-credential probe, handed back whole. `validateApiKey` above
   * narrows the same verdict to a yes/no for the save path; a reader isn't,
   * so "we could not check this" survives to the browser instead of a pass.
   */
  testConnection(
    provider: string,
    customKeys: Record<string, unknown>,
  ): Promise<ModelProviderCredentialVerdict> {
    return this.options.probe.probe({
      provider,
      customKeys: customKeysSchema.parse(customKeys),
    });
  }

  pickExecutionValue(input: {
    customKeys: Record<string, unknown> | null;
    key: string;
  }): string | null {
    const stored = input.customKeys?.[input.key];
    if (typeof stored === "string" && stored.length > 0) {
      return stored;
    }

    return this.options.systemProviderEnvironment[input.key] ?? null;
  }

  isManagedProvider(input: { organizationId: string; provider: string }): boolean {
    return this.options.managed.isManaged(input);
  }

  prepareExecution(input: {
    parameters: Record<string, string>;
    projectId: string;
    model: string;
    provider: string;
  }): Promise<Record<string, string>> {
    return this.options.managed.prepareParameters(input);
  }
}
