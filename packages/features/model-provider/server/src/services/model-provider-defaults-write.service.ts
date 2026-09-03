import {
  ModelDefaultNotFoundError,
  ModelDefaultValidationError,
  ModelProviderInvalidError,
  modelDefaultAssignmentInputSchema,
  modelDefaultConfigWriteInputSchema,
  type ModelDefaultAssignmentInput,
  type ModelDefaultConfig,
  type ModelDefaultConfigWriteInput,
  type ModelDefaultDeleteInput,
} from "@langwatch/model-provider-contract";
import type {
  ModelDefaultRepository,
  ModelProviderCatalog,
  ModelProviderIdService,
} from "../ports/model-provider.port";
import { ModelProviderWriteAuthorizationService } from "./model-provider-write-authorization.service";
import type { ModelProviderScopeService } from "./model-provider-scope.service";

type ModelProviderDefaultsWriteOptions = {
  defaults: ModelDefaultRepository;
  catalog: ModelProviderCatalog;
  writeAuthorization: ModelProviderWriteAuthorizationService;
  ids: ModelProviderIdService;
  scopes: ModelProviderScopeService;
};

export class ModelProviderDefaultsWriteService {
  private constructor(private readonly options: ModelProviderDefaultsWriteOptions) {}

  static create(options: ModelProviderDefaultsWriteOptions): ModelProviderDefaultsWriteService {
    return new ModelProviderDefaultsWriteService(options);
  }

  async set(input: ModelDefaultAssignmentInput): Promise<void> {
    const parsed = modelDefaultAssignmentInputSchema.parse(input);
    const config = this.options.catalog.sanitizeDefaultConfig({
      [parsed.key]: parsed.model ?? "",
    });
    if (parsed.model !== null && !config[parsed.key]) {
      throw new ModelProviderInvalidError(`Model is not allowed for default key: ${parsed.key}`);
    }

    const actorId = parsed.actorId ?? parsed.authorId;
    if (actorId) {
      await this.options.writeAuthorization.assertCanWriteDefault(actorId, [parsed.scope]);
    }

    const organizationId = await this.options.scopes.getOrganizationIdForScope(parsed.scope);
    await this.options.defaults.set({
      id: this.options.ids.generate({ type: "default" }),
      organizationId,
      ...parsed,
      authorId: parsed.authorId ?? null,
    });
  }

  async save(input: ModelDefaultConfigWriteInput): Promise<ModelDefaultConfig> {
    const parsed = modelDefaultConfigWriteInputSchema.parse(input);
    const existing = parsed.id ? await this.options.defaults.tryGetById(parsed.id) : null;
    this.assertExistingConfig(parsed.id, existing);

    if (parsed.scopes?.length === 0) {
      return this.deleteEmptyConfig(parsed.actorId, existing);
    }

    const config = this.options.catalog.sanitizeDefaultConfig(
      parsed.config ?? existing?.config ?? {},
    );
    if (Object.keys(config).length === 0) {
      if (existing) {
        return this.deleteEmptyConfig(parsed.actorId, existing);
      }
      throw new ModelDefaultValidationError(
        "Pick at least one model. A default-models config with every key on inherit has no effect.",
      );
    }

    const scopes = parsed.scopes ?? existing?.scopes ?? [];
    if (scopes.length === 0) {
      throw new ModelDefaultValidationError(
        "Pick at least one scope for this default-models config.",
      );
    }
    if (parsed.actorId) {
      await this.options.writeAuthorization.assertCanWriteDefault(parsed.actorId, [
        ...(existing?.scopes ?? []),
        ...scopes,
      ]);
    }

    const organizationId = await this.options.scopes.getOrganizationIdForScopes(scopes);
    return this.options.defaults.save({
      id: parsed.id ?? this.options.ids.generate({ type: "default" }),
      organizationId,
      config,
      scopes,
      authorId: parsed.authorId ?? existing?.authorId ?? null,
    });
  }

  tryGet(input: { id: string }): Promise<ModelDefaultConfig | null> {
    return this.options.defaults.tryGetById(input.id);
  }

  async delete(input: ModelDefaultDeleteInput): Promise<void> {
    const existing = await this.options.defaults.tryGetById(input.id);
    if (!existing || existing.scopes.length === 0) {
      throw new ModelDefaultNotFoundError();
    }
    if (input.actorId) {
      await this.options.writeAuthorization.assertCanWriteDefault(input.actorId, existing.scopes);
    }

    await this.options.defaults.delete(input.id);
  }

  private assertExistingConfig(id: string | undefined, existing: ModelDefaultConfig | null): void {
    if (id && !existing) {
      throw new ModelDefaultNotFoundError();
    }
    if (existing && existing.scopes.length === 0) {
      throw new ModelDefaultNotFoundError();
    }
  }

  private async deleteEmptyConfig(
    actorId: string | undefined,
    existing: ModelDefaultConfig | null,
  ): Promise<ModelDefaultConfig> {
    if (!existing) {
      throw new ModelDefaultNotFoundError();
    }
    if (actorId) {
      await this.options.writeAuthorization.assertCanWriteDefault(actorId, existing.scopes);
    }

    await this.options.defaults.delete(existing.id);
    return existing;
  }
}
