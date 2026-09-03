import { z } from "zod";
import {
  getProviderModelOptions,
  modelProviders,
  type ModelProviderApiKeyValidation,
  type ModelProviderCredentialVerdict,
  type ModelProviderSummary,
} from "@langwatch/model-provider-contract";
import {
  ModelProviderCatalog,
  ModelProviderManagedGatewayPort,
  type ModelProviderCredentialProbePort,
} from "../ports/model-provider.port";

export type RegistryModelProviderCatalogOptions = {
  /**
   * Whether LangWatch supplies a provider's credentials for an organization,
   * and with what. The composition root adapts its Enterprise service onto
   * this; a deployment with no managed providers passes the unmanaged
   * stand-in below and every provider is the customer's own.
   */
  managed: ModelProviderManagedGatewayPort;
  /** Probes a credential against the provider itself. */
  probe: ModelProviderCredentialProbePort;
  /**
   * The process configuration a SYSTEM provider's credential is read from.
   *
   * Passed in whole rather than read here: which variables carry a provider
   * key is the registry's business, but whether this process has them is the
   * deployment's, and a package that read `process.env` would be answering for
   * a deployment it cannot see.
   */
  systemProviderEnvironment: Readonly<Record<string, string | undefined>>;
  /**
   * Whether this deployment is the hosted one.
   *
   * System providers are only ever enabled on it: a self-hosted install that
   * happened to have `OPENAI_API_KEY` in its environment would otherwise find
   * a provider it never configured switched on for every project.
   */
  isSaas: boolean;
};

/**
 * The catalogue answered from the packaged provider registry and this
 * process's own configuration.
 *
 * Everything the base class can derive from the registry it still derives —
 * model lists, feature defaults, routing-handle rules, static cost rates. What
 * this adds is the four answers that are a DEPLOYMENT's rather than a
 * registry's: which system providers it credentials, what a stored credential
 * resolves to at execution time, whether an organization's provider is managed
 * by LangWatch, and what the provider itself says about a key.
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
    referenceCreatedAt: Date;
  }): Promise<ModelProviderSummary[]> {
    const now = new Date(0);
    const organizationId = input.organizationId ?? `system:${input.projectId ?? "global"}`;
    return Promise.resolve(
      Object.entries(modelProviders)
        .filter(([, definition]) => definition.enabledSince)
        .map(([provider, definition]) => {
          const enabled =
            definition.enabledSince < input.referenceCreatedAt &&
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
      customKeys: z.record(z.string(), z.string()).parse(customKeys),
    });
    return { valid: result.valid, message: result.valid ? undefined : result.outcome };
  }

  /**
   * The stored-credential probe, handed back whole.
   *
   * `validateApiKey` above narrows the same verdict to what the save path
   * needs, because a save is a yes-or-no decision. A reader is not: this
   * returns the probe's own answer so "we could not check this" survives the
   * trip to the browser instead of arriving as a pass.
   */
  testConnection(
    provider: string,
    customKeys: Record<string, unknown>,
  ): Promise<ModelProviderCredentialVerdict> {
    return this.options.probe.probe({
      provider,
      customKeys: z.record(z.string(), z.string()).parse(customKeys),
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

/**
 * The managed-provider answer for a deployment that has none.
 *
 * Named rather than defaulted: "no organization is managed, and parameters
 * travel unchanged" is the true answer for every self-hosted install, and
 * stating it here is what keeps a deployment that DOES have managed providers
 * from getting it by omission.
 */
export class UnmanagedModelProviderGatewayAdapter extends ModelProviderManagedGatewayPort {
  static create(): UnmanagedModelProviderGatewayAdapter {
    return new UnmanagedModelProviderGatewayAdapter();
  }

  isManaged(_input: { organizationId: string; provider: string }): boolean {
    return false;
  }

  prepareParameters(input: {
    parameters: Record<string, string>;
    projectId: string;
    model: string;
    provider: string;
  }): Promise<Record<string, string>> {
    return Promise.resolve(input.parameters);
  }
}
