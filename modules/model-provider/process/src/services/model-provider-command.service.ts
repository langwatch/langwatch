import { HandledError } from "@langwatch/handled-error";
import {
  ModelProviderAnchorRequiredError,
  ModelProviderDeprecatedError,
  ModelProviderInvalidError,
  ModelProviderNotFoundError,
  ModelProviderRoutingHandleInvalidError,
  ModelProviderRoutingHandleTakenError,
  ModelProviderSkipPermissionsPatternInvalidError,
  detectInvalidSkipPattern,
  modelProviderApiKeyValidationInputSchema,
  modelProviderDeleteInputSchema,
  modelProviderSchema,
  modelProviderTestConnectionInputSchema,
  modelProviderWriteInputSchema,
  type ModelDefaultScope,
  type ModelProvider,
  type ModelProviderApiKeyValidation,
  type ModelProviderApiKeyValidationInput,
  type ModelProviderCredentialVerdict,
  type ModelProviderDeleteInput,
  type ModelProviderTestConnectionInput,
  type ModelProviderWriteInput,
} from "@langwatch/model-provider-contract";
import { nowInstant, toDate } from "@langwatch/time";

import type { ModelProviderConnectionPingService } from "../features/credential-probe/services/model-provider-connection-ping.service.ts";
import type { ModelProviderConnectionRateLimiter } from "../features/credential-probe/services/windowed-model-provider-connection-rate-limiter.service.ts";
import type { ModelProviderOnboardingDefaultsService } from "../features/defaults/services/model-provider-onboarding-defaults.service.ts";
import type { ModelDefaultRepository } from "../repositories/model-default.repository.ts";
import type { ModelProviderRepository } from "../repositories/model-provider.repository.ts";
import {
  defaultScopeForWrite,
  deriveSkipPermissionsForWrite,
  humanize,
  modelsForWrite,
  rateLimitsForWrite,
  scopesForWrite,
} from "../rules/model-provider-write.rules.ts";
import type { ModelProviderCredentialPolicy } from "./model-provider-keys.service.ts";
import type { ModelProviderScopeService } from "./model-provider-scope.service.ts";
import type { ModelProviderWriteAuthorizationService } from "./model-provider-write-authorization.service.ts";
import type { ModelProviderIdService } from "./prefixed-model-provider-id.service.ts";
import type { ModelProviderCatalog } from "./registry-model-provider-catalog.service.ts";

type ModelProviderCommandOptions = {
  repository: ModelProviderRepository;
  defaults: ModelDefaultRepository;
  credentialPolicy: ModelProviderCredentialPolicy;
  catalog: ModelProviderCatalog;
  connectionRateLimiter: ModelProviderConnectionRateLimiter;
  connectionPing: ModelProviderConnectionPingService;
  writeAuthorization: ModelProviderWriteAuthorizationService;
  onboardingDefaults: ModelProviderOnboardingDefaultsService;
  ids: ModelProviderIdService;
  scopes: ModelProviderScopeService;
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
    this.assertValidSkipPermissionsPatterns(parsed.langySkipPermissionsModels);
    const existing = await this.getExistingProvider(parsed);
    const scopes = scopesForWrite(parsed, existing);
    await this.authorizeWrite(parsed, existing?.scopes, scopes);
    const organizationId = await this.resolveOrganizationId(parsed, existing, scopes);
    const provider = await this.providerValue({
      parsed,
      existing,
      scopes,
      organizationId,
      routingHandle,
    });
    const saved = await this.saveProvider(provider, existing, routingHandle);

    await this.seedOnboardingDefaults(existing, saved);
    await this.saveProjectDefault(parsed);

    return this.withMaskedCredentials(saved);
  }

  /** A write answers what a read answers: the caller already holds what it sent. */
  private withMaskedCredentials(provider: ModelProvider): ModelProvider {
    return {
      ...provider,
      customKeys: this.options.credentialPolicy.toMaskedKeys(provider.customKeys),
      extraHeaders: this.options.credentialPolicy.maskHeaders(provider.extraHeaders),
    };
  }

  /** The project key's legacy shape: the provider string names the one row it already holds. */
  async upsertByProviderKey(input: ModelProviderWriteInput): Promise<ModelProvider> {
    const [existing] = await this.findOwnProjectRows(input);
    return this.upsert(existing ? { ...input, id: existing.id } : input);
  }

  private findOwnProjectRows(input: ModelProviderWriteInput): Promise<ModelProvider[]> {
    if (!input.projectId) return Promise.resolve([]);

    return this.options.repository
      .getByProviderForProject({
        provider: input.provider,
        projectScopes: [{ scopeType: "PROJECT", scopeId: input.projectId }],
      })
      .then((row) => [row])
      .catch((error: unknown) => {
        if (error instanceof ModelProviderNotFoundError) return [];
        throw error;
      });
  }

  async delete(input: ModelProviderDeleteInput): Promise<void> {
    this.assertTenantAnchor(input);

    const parsed = modelProviderDeleteInputSchema.parse(input);
    const organizationId = await this.getAnchorOrganizationId(parsed);
    const existingByProvider = async () => {
      if (!parsed.projectId) throw new ModelProviderNotFoundError();
      const projectScopes = await this.options.scopes
        .getProjectScopes(parsed.projectId)
        .catch((error: unknown) => {
          if (HandledError.isHandled(error) && error.code === "project_not_found")
            throw new ModelProviderNotFoundError();
          throw error;
        });
      return this.options.repository.getByProviderForProject({
        provider: parsed.provider,
        projectScopes,
      });
    };
    const existing = parsed.id
      ? await this.options.repository.getById({ id: parsed.id, organizationId })
      : await existingByProvider();

    if (parsed.actorId) {
      await this.options.writeAuthorization.assertCanWrite(parsed.actorId, existing.scopes);
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
  ): Promise<ModelProviderCredentialVerdict> {
    const parsed = modelProviderTestConnectionInputSchema.parse(input);
    const organizationId = await this.getAnchorOrganizationId(parsed);

    const provider = await this.options.repository.getById({
      id: parsed.modelProviderId,
      organizationId,
    });
    if (provider.scopes.length === 0) {
      throw new ModelProviderNotFoundError();
    }

    if (parsed.actorId) {
      await this.options.writeAuthorization.assertCanWrite(parsed.actorId, provider.scopes);
    }

    await this.options.connectionRateLimiter.assertAvailable({ organizationId });

    const credential = await this.options.catalog.testConnection(
      provider.provider,
      provider.customKeys ?? {},
    );
    return this.options.connectionPing.verify({
      row: provider,
      projectId: parsed.projectId,
      credential,
    });
  }

  /** An anchor project that is gone reads as the provider not being there. */
  private getAnchorOrganizationId(input: {
    projectId?: string;
    organizationId?: string;
  }): Promise<string> {
    return this.options.scopes
      .getAnchorOrganizationId({ projectId: input.projectId, organizationId: input.organizationId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "project_not_found")
          throw new ModelProviderNotFoundError();
        throw error;
      });
  }

  private assertTenantAnchor(input: { projectId?: string; organizationId?: string }): void {
    if (!input.projectId && !input.organizationId) {
      throw new ModelProviderAnchorRequiredError("project_or_organization");
    }
  }

  private assertKnownProvider(provider: string): void {
    if (!this.options.catalog.exists(provider)) {
      throw new ModelProviderInvalidError(`Unknown provider: ${provider}`);
    }
  }

  private normalizeRoutingHandle(handle: string | null | undefined): string | null | undefined {
    if (handle === undefined) {
      return undefined;
    }

    const normalized = this.options.catalog.normalizeRoutingHandle(handle);
    const problem = this.options.catalog.classifyRoutingHandleProblem(normalized);
    if (problem) {
      throw new ModelProviderRoutingHandleInvalidError({
        handle: normalized ?? "",
        problem,
      });
    }

    return normalized;
  }

  /**
   * Checked before any database work: a line that never compiles matches
   * nothing, so storing it would leave the operator believing a model is
   * trusted when the gate always says no.
   */
  private assertValidSkipPermissionsPatterns(patterns: readonly string[] | null | undefined): void {
    if (!patterns) {
      return;
    }

    const invalid = detectInvalidSkipPattern(patterns);
    if (invalid) {
      throw new ModelProviderSkipPermissionsPatternInvalidError(invalid);
    }
  }

  private async getExistingProvider(input: ModelProviderWriteInput): Promise<ModelProvider | null> {
    const existing = input.id ? await this.getProviderById({ ...input, id: input.id }) : null;
    // A row id names that row only for its own provider; never rewrite one provider into another.
    if (existing && existing.provider !== input.provider) throw new ModelProviderNotFoundError();

    if (!existing) {
      const deprecation = this.options.catalog.pickProviderDeprecation(input.provider);
      if (deprecation) {
        throw new ModelProviderDeprecatedError({
          provider: input.provider,
          replacement: deprecation.replacement,
        });
      }
    }

    return existing;
  }

  private getProviderById(input: ModelProviderWriteInput & { id: string }): Promise<ModelProvider> {
    return input.actorId
      ? this.getOrganizationProvider(input)
      : this.getProjectReachableProvider(input);
  }

  /**
   * The settings list shows every provider of the organization, whichever project the page is
   * on, so an attributed save finds the row by id within the organization, as delete does.
   * `authorizeWrite` then asks write on the scopes the row already lives in.
   */
  private async getOrganizationProvider(
    input: ModelProviderWriteInput & { id: string },
  ): Promise<ModelProvider> {
    const organizationId = await this.getAnchorOrganizationId(input);
    const existing = await this.options.repository.getById({ id: input.id, organizationId });
    // A row attached nowhere has no scopes to authorize against, so it is no one's to save.
    if (existing.scopes.length === 0) throw new ModelProviderNotFoundError();

    return existing;
  }

  /** An unattributed write is authorized by its credential's project, so it reaches no further. */
  private async getProjectReachableProvider(
    input: ModelProviderWriteInput & { id: string },
  ): Promise<ModelProvider> {
    const projectScopes = input.projectId
      ? await this.options.scopes.getProjectScopes(input.projectId).catch((error: unknown) => {
          if (HandledError.isHandled(error) && error.code === "project_not_found") return undefined;
          throw error;
        })
      : undefined;

    return this.options.repository.getById({
      id: input.id,
      organizationId: input.organizationId,
      ...(projectScopes ? { projectScopes } : {}),
    });
  }

  private async authorizeWrite(
    input: ModelProviderWriteInput,
    oldScopes: ModelDefaultScope[] | undefined,
    scopes: ModelDefaultScope[],
  ): Promise<void> {
    if (!input.actorId) {
      return;
    }

    await this.options.writeAuthorization.assertCanWrite(input.actorId, [
      ...(oldScopes ?? []),
      ...scopes,
      ...defaultScopeForWrite(input),
    ]);
  }

  private async resolveOrganizationId(
    input: ModelProviderWriteInput,
    existing: ModelProvider | null,
    scopes: ModelDefaultScope[],
  ): Promise<string> {
    const organizationId =
      existing?.organizationId ??
      (await this.options.scopes
        .getAnchorOrganizationId({
          projectId: input.projectId,
          organizationId: input.organizationId,
        })
        .catch((error: unknown) => {
          if (HandledError.isHandled(error) && error.code === "project_not_found") {
            throw new ModelProviderInvalidError(
              "Provider scope does not resolve to an organization",
            );
          }
          throw error;
        }));

    const scopeOrganizationId = await this.options.scopes.getOrganizationIdForScopes(scopes);
    if (organizationId !== scopeOrganizationId) {
      throw new ModelProviderInvalidError("Provider scopes must belong to one organization");
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
    const models = modelsForWrite(parsed, existing);
    const rateLimits = rateLimitsForWrite(parsed, existing);
    const now = toDate(nowInstant());

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
      langySkipPermissionsModels: deriveSkipPermissionsForWrite(parsed, existing),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  private async credentialsForWrite(
    input: ModelProviderWriteInput,
    existing: ModelProvider | null,
  ): Promise<Record<string, unknown> | null> {
    if (input.customKeys === undefined) {
      return existing?.customKeys ?? null;
    }

    const normalized = this.options.credentialPolicy.normalizeKeys(
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

    const merged = this.options.credentialPolicy.merge({
      incoming: normalized,
      stored: existing?.customKeys ?? null,
    });
    await this.options.catalog.assertEndpointAllowed(input.provider, merged);
    return merged;
  }

  private headersForWrite(
    input: ModelProviderWriteInput,
    existing: ModelProvider | null,
  ): { key: string; value: string }[] {
    const policy = this.options.credentialPolicy;
    const endpointMoved = policy.endpointMoved({
      incoming:
        input.customKeys === undefined
          ? null
          : policy.normalizeKeys(input.provider, input.customKeys),
      stored: existing?.customKeys ?? null,
    });
    if (input.extraHeaders === undefined) {
      return endpointMoved ? [] : (existing?.extraHeaders ?? []);
    }

    return policy.mergeHeaders({
      incoming: input.extraHeaders ?? [],
      stored: existing?.extraHeaders ?? [],
      endpointMoved,
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
      if (routingHandle !== undefined && this.options.repository.isRoutingHandleConflict(error)) {
        throw new ModelProviderRoutingHandleTakenError({ handle: routingHandle ?? "" });
      }

      throw error;
    }
  }

  /** A row created disabled, or turned off and back on, is seeded on the enable flip. */
  private async seedOnboardingDefaults(
    existing: ModelProvider | null,
    saved: ModelProvider,
  ): Promise<void> {
    if (!existing || (saved.enabled && !existing.enabled)) {
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
