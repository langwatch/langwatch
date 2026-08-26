import {
  ModelProviderAnchorRequiredError,
  ModelProviderDeprecatedError,
  ModelProviderInvalidError,
  ModelProviderNotFoundError,
  ModelProviderRoutingHandleInvalidError,
  ModelProviderRoutingHandleTakenError,
  ModelProviderScopesRequiredError,
  modelProviderApiKeyValidationInputSchema,
  modelProviderDeleteInputSchema,
  modelProviderSchema,
  modelProviderTestConnectionInputSchema,
  modelProviderWriteInputSchema,
  type ModelDefaultScope,
  type ModelProvider,
  type ModelProviderApiKeyValidation,
  type ModelProviderApiKeyValidationInput,
  type ModelProviderDeleteInput,
  type ModelProviderTestConnectionInput,
  type ModelProviderWriteInput,
} from "@langwatch/model-provider-contract";
import type {
  ModelDefaultRepository,
  ModelProviderCatalog,
  ModelProviderConnectionRateLimiter,
  ModelProviderCredentialPolicy,
  ModelProviderIdService,
  ModelProviderRepository,
} from "../ports/model-provider.port";
import { ModelProviderOnboardingDefaultsService } from "./model-provider-onboarding-defaults.service";
import { ModelProviderWriteAuthorizationService } from "./model-provider-write-authorization.service";
import type { ModelProviderScopeService } from "./model-provider-scope.service";

type ModelProviderCommandOptions = {
  repository: ModelProviderRepository;
  defaults: ModelDefaultRepository;
  credentialPolicy: ModelProviderCredentialPolicy;
  catalog: ModelProviderCatalog;
  connectionRateLimiter: ModelProviderConnectionRateLimiter;
  writeAuthorization: ModelProviderWriteAuthorizationService;
  onboardingDefaults: ModelProviderOnboardingDefaultsService;
  ids: ModelProviderIdService;
  scopes: ModelProviderScopeService;
};

type ProviderModelsForWrite = {
  customModels: ModelProvider["customModels"];
  customEmbeddingsModels: ModelProvider["customEmbeddingsModels"];
};

type ProviderRateLimitsForWrite = {
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
  rateLimitRpd: number | null;
  fallbackPriorityGlobal: number | null;
};

export class ModelProviderCommandService {
  private constructor(private readonly options: ModelProviderCommandOptions) {}

  static create(options: ModelProviderCommandOptions): ModelProviderCommandService {
    return new ModelProviderCommandService(options);
  }

  async upsert(input: ModelProviderWriteInput): Promise<ModelProvider> {
    this.assertTenantAnchor(input);

    const parsed = modelProviderWriteInputSchema.parse(input);
    this.assertKnownProvider(parsed.provider);
    const routingHandle = this.normalizeRoutingHandle(parsed.routingHandle);
    const existing = await this.getExistingProvider(parsed);
    const scopes = this.scopesForWrite(parsed, existing);
    await this.authorizeWrite(parsed.actorId, existing?.scopes, scopes);
    const organizationId = await this.resolveOrganizationId(parsed, existing, scopes);
    const provider = await this.providerValue({
      parsed,
      existing,
      scopes,
      organizationId,
      routingHandle,
    });
    const saved = await this.saveProvider(provider, existing, routingHandle);

    await this.seedNewProvider(existing, saved);
    await this.saveProjectDefault(parsed);
    return saved;
  }

  async delete(input: ModelProviderDeleteInput): Promise<void> {
    this.assertTenantAnchor(input);

    const parsed = modelProviderDeleteInputSchema.parse(input);
    const organizationId = await this.options.scopes.tryResolveAnchor({
      projectId: parsed.projectId,
      organizationId: parsed.organizationId,
    });
    if (!organizationId) {
      throw new ModelProviderNotFoundError();
    }

    const projectScopes = parsed.projectId
      ? await this.options.scopes.tryGetProjectScopes(parsed.projectId)
      : null;
    const existing = parsed.id
      ? await this.options.repository.tryFindById({ id: parsed.id, organizationId })
      : projectScopes
        ? await this.options.repository.tryFindByProviderForProject({
            provider: parsed.provider,
            projectScopes,
          })
        : null;
    if (!existing) {
      throw new ModelProviderNotFoundError();
    }

    if (parsed.actorId) {
      await this.options.writeAuthorization.assertCanWrite(
        parsed.actorId,
        existing.scopes,
      );
    }
    await this.options.repository.delete({
      id: existing.id,
      organizationId: existing.organizationId,
      projectId: parsed.projectId,
    });
  }

  async validateApiKey(
    input: ModelProviderApiKeyValidationInput,
  ): Promise<ModelProviderApiKeyValidation> {
    const parsed = modelProviderApiKeyValidationInputSchema.parse(input);
    this.assertKnownProvider(parsed.provider);

    return this.options.catalog.validateApiKey(parsed.provider, parsed.customKeys);
  }

  async testConnection(
    input: ModelProviderTestConnectionInput,
  ): Promise<{ connected: boolean }> {
    const parsed = modelProviderTestConnectionInputSchema.parse(input);
    const organizationId = await this.options.scopes.tryResolveAnchor({
      projectId: parsed.projectId,
      organizationId: parsed.organizationId,
    });
    if (!organizationId) {
      throw new ModelProviderNotFoundError();
    }

    const provider = await this.options.repository.tryFindById({
      id: parsed.modelProviderId,
      organizationId,
    });
    if (!provider || provider.scopes.length === 0) {
      throw new ModelProviderNotFoundError();
    }

    if (parsed.actorId) {
      await this.options.writeAuthorization.assertCanWrite(
        parsed.actorId,
        provider.scopes,
      );
    }
    await this.options.connectionRateLimiter.assertAvailable({ organizationId });

    return this.options.catalog.testConnection(
      provider.provider,
      provider.customKeys ?? {},
    );
  }

  private assertTenantAnchor(input: {
    projectId?: string;
    organizationId?: string;
  }): void {
    if (!input.projectId && !input.organizationId) {
      throw new ModelProviderAnchorRequiredError("project_or_organization");
    }
  }

  private assertKnownProvider(provider: string): void {
    if (!this.options.catalog.exists(provider)) {
      throw new ModelProviderInvalidError(`Unknown provider: ${provider}`);
    }
  }

  private normalizeRoutingHandle(
    handle: string | null | undefined,
  ): string | null | undefined {
    if (handle === undefined) {
      return undefined;
    }

    const normalized = this.options.catalog.tryNormalizeRoutingHandle(handle);
    const problem = this.options.catalog.tryGetRoutingHandleProblem(normalized);
    if (problem) {
      throw new ModelProviderRoutingHandleInvalidError({
        handle: normalized ?? "",
        problem,
      });
    }

    return normalized;
  }

  private async getExistingProvider(
    input: ModelProviderWriteInput,
  ): Promise<ModelProvider | null> {
    const projectScopes = input.projectId
      ? await this.options.scopes.tryGetProjectScopes(input.projectId)
      : null;
    const existing = input.id
      ? await this.options.repository.tryFindById({
          id: input.id,
          organizationId: input.organizationId,
          ...(projectScopes ? { projectScopes } : {}),
        })
      : null;
    if (input.id && !existing) {
      throw new ModelProviderNotFoundError();
    }

    if (!existing) {
      const deprecation = this.options.catalog.tryGetProviderDeprecation(input.provider);
      if (deprecation) {
        throw new ModelProviderDeprecatedError({
          provider: input.provider,
          replacement: deprecation.replacement,
        });
      }
    }

    return existing;
  }

  private scopesForWrite(
    input: ModelProviderWriteInput,
    existing: ModelProvider | null,
  ): ModelDefaultScope[] {
    if (input.scopes) {
      return input.scopes;
    }
    if (input.projectId) {
      return [{ scopeType: "PROJECT", scopeId: input.projectId }];
    }
    if (existing) {
      return existing.scopes;
    }

    throw new ModelProviderScopesRequiredError();
  }

  private async authorizeWrite(
    actorId: string | undefined,
    oldScopes: ModelDefaultScope[] | undefined,
    scopes: ModelDefaultScope[],
  ): Promise<void> {
    if (!actorId) {
      return;
    }

    await this.options.writeAuthorization.assertCanWrite(actorId, [
      ...(oldScopes ?? []),
      ...scopes,
    ]);
  }

  private async resolveOrganizationId(
    input: ModelProviderWriteInput,
    existing: ModelProvider | null,
    scopes: ModelDefaultScope[],
  ): Promise<string> {
    const organizationId =
      existing?.organizationId ??
      (await this.options.scopes.tryResolveAnchor({
        projectId: input.projectId,
        organizationId: input.organizationId,
      }));
    if (!organizationId) {
      throw new ModelProviderInvalidError(
        "Provider scope does not resolve to an organization",
      );
    }

    const scopeOrganizationId =
      await this.options.scopes.getOrganizationIdForScopes(scopes);
    if (organizationId !== scopeOrganizationId) {
      throw new ModelProviderInvalidError(
        "Provider scopes must belong to one organization",
      );
    }

    return organizationId;
  }

  private async providerValue(input: {
    parsed: ModelProviderWriteInput;
    existing: ModelProvider | null;
    scopes: ModelDefaultScope[];
    organizationId: string;
    routingHandle: string | null | undefined;
  }): Promise<ModelProvider> {
    const { parsed, existing, scopes, organizationId, routingHandle } = input;
    const customKeys = await this.credentialsForWrite(parsed, existing);
    const extraHeaders = this.headersForWrite(parsed, existing);
    const models = this.modelsForWrite(parsed, existing);
    const rateLimits = this.rateLimitsForWrite(parsed, existing);
    const now = new Date();

    return modelProviderSchema.parse({
      id: existing?.id ?? parsed.id ?? this.options.ids.generate({ type: "provider" }),
      organizationId,
      provider: parsed.provider,
      name: parsed.name ?? existing?.name ?? humanize(parsed.provider),
      enabled: parsed.enabled,
      defaultModel: parsed.defaultModel,
      routingHandle:
        routingHandle === undefined ? (existing?.routingHandle ?? null) : routingHandle,
      scopes,
      customKeys,
      ...models,
      extraHeaders,
      ...rateLimits,
      providerConfig:
        parsed.providerConfig === undefined
          ? (existing?.providerConfig ?? null)
          : parsed.providerConfig,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  private modelsForWrite(
    parsed: ModelProviderWriteInput,
    existing: ModelProvider | null,
  ): ProviderModelsForWrite {
    return {
      customModels:
        parsed.customModels === undefined
          ? (existing?.customModels ?? [])
          : (parsed.customModels ?? []),
      customEmbeddingsModels:
        parsed.customEmbeddingsModels === undefined
          ? (existing?.customEmbeddingsModels ?? [])
          : (parsed.customEmbeddingsModels ?? []),
    };
  }

  private rateLimitsForWrite(
    parsed: ModelProviderWriteInput,
    existing: ModelProvider | null,
  ): ProviderRateLimitsForWrite {
    return {
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
    };
  }

  private async credentialsForWrite(
    input: ModelProviderWriteInput,
    existing: ModelProvider | null,
  ): Promise<Record<string, unknown> | null> {
    if (input.customKeys === undefined) {
      return existing?.customKeys ?? null;
    }

    const normalized = this.options.credentialPolicy.tryNormalize(
      input.provider,
      input.customKeys,
    );
    const storedCredentialsAreUnreadable =
      existing &&
      existing.customKeys === null &&
      (await this.options.repository.hasStoredCredentials(existing.id));
    this.options.credentialPolicy.assertCredentialsCanBeSaved({
      provider: input.provider,
      incoming: normalized,
      stored: existing?.customKeys ?? null,
      storedCredentialsUnreadable: Boolean(storedCredentialsAreUnreadable),
    });

    return this.options.credentialPolicy.merge({
      incoming: normalized,
      stored: existing?.customKeys ?? null,
    });
  }

  private headersForWrite(
    input: ModelProviderWriteInput,
    existing: ModelProvider | null,
  ): Array<{ key: string; value: string }> {
    if (input.extraHeaders === undefined) {
      return existing?.extraHeaders ?? [];
    }

    return this.options.credentialPolicy.mergeHeaders({
      incoming: input.extraHeaders ?? [],
      stored: existing?.extraHeaders ?? [],
    });
  }

  private async saveProvider(
    provider: ModelProvider,
    existing: ModelProvider | null,
    routingHandle: string | null | undefined,
  ): Promise<ModelProvider> {
    try {
      return existing
        ? await this.options.repository.update(provider)
        : await this.options.repository.create(provider);
    } catch (error) {
      if (
        routingHandle !== undefined &&
        this.options.repository.isRoutingHandleConflict(error)
      ) {
        throw new ModelProviderRoutingHandleTakenError({ handle: routingHandle ?? "" });
      }

      throw error;
    }
  }

  private async seedNewProvider(
    existing: ModelProvider | null,
    saved: ModelProvider,
  ): Promise<void> {
    if (!existing) {
      await this.options.onboardingDefaults.seed({
        provider: saved.provider,
        scopes: saved.scopes,
      });
    }
  }

  private async saveProjectDefault(input: ModelProviderWriteInput): Promise<void> {
    if (input.defaultModel !== undefined && input.projectId) {
      const organizationId = await this.options.scopes.getOrganizationIdForScope({
        scopeType: "PROJECT",
        scopeId: input.projectId,
      });
      await this.options.defaults.set({
        id: this.options.ids.generate({ type: "default" }),
        organizationId,
        scope: { scopeType: "PROJECT", scopeId: input.projectId },
        key: "DEFAULT",
        model: input.defaultModel,
        authorId: null,
      });
    }
  }
}

function humanize(provider: string): string {
  return provider.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
