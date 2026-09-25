import {
  getProviderModelOptions,
  modelProviders,
  type ModelProviderApiKeyValidation,
  type ModelProviderCredentialVerdict,
  type ModelProviderSummary,
} from "@langwatch/model-provider-contract";
import { Temporal, toDate, type Instant } from "@langwatch/time";
import { z } from "zod";

import {
  type ModelProviderManagedGateway,
  ModelProviderCatalog,
  type ModelProviderCredentialProbe,
} from "../app/model-provider.members.ts";

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
export class RegistryModelProviderCatalogAdapter extends ModelProviderCatalog {
  static create(options: RegistryModelProviderCatalogOptions): RegistryModelProviderCatalogAdapter {
    return new RegistryModelProviderCatalogAdapter(options);
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

  tryGetExecutionValue(input: {
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
