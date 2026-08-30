import {
  ApiKeyAlreadyRevokedError,
  ApiKeyNotFoundError,
  ApiKeyNotOwnedError,
  ApiKeyReservedNameError,
  ApiKeyScopeViolationError,
} from "@langwatch/api-key-contract";
import {
  createApiKeyInputSchema,
  type ApiKey,
  type ApiKeyScope,
  type CreateApiKeyInput,
  type RevokeApiKeyInput,
  type UpdateApiKeyInput,
  API_KEY_PREFIX,
  INGEST_KEY_PREFIX,
  HIDDEN_SYSTEM_KEY_NAMES,
} from "@langwatch/api-key-contract";
import type { ApiKeyRepository, StoredApiKey } from "../repositories/api-key.repository";
import type { ApiKeyDependencies } from "./api-key.service";
import { ApiKeyGrantPolicyService } from "./api-key-grant-policy.service";

const SYSTEM_NAMES = new Set(HIDDEN_SYSTEM_KEY_NAMES);

function publicApiKey(row: StoredApiKey): ApiKey {
  const { hashedSecret: _hashedSecret, ...key } = row;
  return key;
}

function actor(userId: string | null | undefined): {
  type: "user" | "system";
  id: string | null;
} {
  return userId ? { type: "user", id: userId } : { type: "system", id: null };
}

export class ApiKeyLifecycleService {
  static create(
    options: ApiKeyDependencies & { repository: ApiKeyRepository },
    grants: ApiKeyGrantPolicyService,
  ): ApiKeyLifecycleService {
    return new ApiKeyLifecycleService(options.repository, options, grants);
  }

  private constructor(
    private readonly repository: ApiKeyRepository,
    private readonly options: ApiKeyDependencies,
    private readonly grants: ApiKeyGrantPolicyService,
  ) {}

  async create(input: CreateApiKeyInput): Promise<{ token: string; apiKey: ApiKey }> {
    const parsed = createApiKeyInputSchema.parse(input);
    if (!parsed.isSystemManaged && SYSTEM_NAMES.has(parsed.name)) {
      throw new ApiKeyReservedNameError(parsed.name);
    }
    const bindings = parsed.bindings;
    const permissions = this.grants.tryValidatePermissionSelection({
      bindings,
      permissionMode: parsed.permissionMode ?? "all",
      permissions: parsed.permissions,
    });
    await this.validateCreateBindings({
      userId: parsed.userId ?? null,
      organizationId: parsed.organizationId,
      bindings,
      permissions,
    });
    const effectiveBindings =
      parsed.userId || bindings.length
        ? bindings
        : [
            {
              scopeType: "ORGANIZATION" as const,
              scopeId: parsed.organizationId,
              role: "ADMIN" as const,
            },
          ];
    if (parsed.userId && effectiveBindings.length === 0) {
      throw new ApiKeyScopeViolationError("A personal API key needs at least one role binding");
    }
    const generated = this.options.tokens.generate({
      prefix: parsed.ingestSourceType ? INGEST_KEY_PREFIX : API_KEY_PREFIX,
    });
    const row = await this.repository.create({
      name: parsed.name,
      description: parsed.description ?? null,
      lookupId: generated.lookupId,
      hashedSecret: generated.hashedSecret,
      permissionMode: parsed.permissionMode ?? "default",
      userId: parsed.userId ?? null,
      createdByUserId: parsed.createdByUserId ?? null,
      createdByDeviceLabel: parsed.createdByDeviceLabel ?? null,
      organizationId: parsed.organizationId,
      expiresAt: parsed.expiresAt ?? null,
      ingestSourceType: parsed.ingestSourceType ?? null,
      ingestionTemplateId: parsed.ingestionTemplateId ?? null,
      startsDisabled: true,
      roleBindings: effectiveBindings,
    });
    await this.grants.writeBindings({
      apiKeyId: row.id,
      organizationId: parsed.organizationId,
      bindings: effectiveBindings,
      permissions,
      actor: actor(parsed.createdByUserId ?? parsed.userId),
      roleId: `apikey:${row.id}`,
    });
    return {
      token: generated.token,
      apiKey: publicApiKey(await this.repository.activate({ id: row.id })),
    };
  }

  async update(input: UpdateApiKeyInput): Promise<ApiKey> {
    const existing = await this.getInOrganization(input.id, input.organizationId);
    if (
      SYSTEM_NAMES.has(existing.name) ||
      (input.name !== void 0 && SYSTEM_NAMES.has(input.name))
    ) {
      throw new ApiKeyNotFoundError(input.id);
    }
    if (
      !input.callerIsAdmin &&
      (existing.userId === null || existing.userId !== input.callerUserId)
    ) {
      throw new ApiKeyNotOwnedError(input.id);
    }
    if (existing.revokedAt) {
      throw new ApiKeyAlreadyRevokedError(input.id);
    }
    const hasPermissionUpdate =
      input.bindings !== void 0 || input.permissionMode !== void 0 || input.permissions !== void 0;
    const permissions = hasPermissionUpdate
      ? this.grants.tryValidatePermissionSelection({
          bindings: input.bindings ?? [],
          permissionMode: input.permissionMode ?? existing.permissionMode,
          permissions: input.permissions,
        })
      : void 0;
    if (input.bindings) {
      for (const binding of input.bindings) {
        await this.grants.validateScope(binding, input.organizationId);
      }
      await this.grants.assertPersonalScopesOwnedBy({
        scopes: input.bindings,
        organizationId: input.organizationId,
        ownerUserId: existing.userId,
      });
      if (existing.userId) {
        await this.grants.assertCeiling(
          existing.userId,
          input.organizationId,
          input.bindings,
          permissions ?? [],
        );
      }
    }
    const effectiveBindings =
      input.bindings === void 0
        ? void 0
        : await this.grants.writeBindings({
            apiKeyId: input.id,
            organizationId: input.organizationId,
            bindings: input.bindings,
            permissions,
            actor: actor(input.callerUserId),
            replace: true,
          });
    return publicApiKey(
      await this.repository.update({
        id: input.id,
        name: input.name,
        description: input.description,
        permissionMode: input.permissionMode,
        roleBindings: effectiveBindings,
      }),
    );
  }

  async revoke(input: RevokeApiKeyInput): Promise<ApiKey> {
    const existing = await this.getInOrganization(input.id, input.organizationId);
    if (SYSTEM_NAMES.has(existing.name)) {
      throw new ApiKeyNotFoundError(input.id);
    }
    if (
      !input.callerIsAdmin &&
      (existing.userId === null || existing.userId !== input.callerUserId)
    ) {
      throw new ApiKeyNotOwnedError(input.id);
    }
    if (existing.revokedAt) {
      throw new ApiKeyAlreadyRevokedError(input.id);
    }
    await this.options.grants.revokeBindingsWhere({
      organizationId: input.organizationId,
      where: { apiKeyId: input.id },
      actor: actor(input.callerUserId),
      reason: "api key revoked",
    });
    const customRoleIds = [
      ...new Set(
        existing.roleBindings.flatMap((binding) =>
          binding.customRoleId ? [binding.customRoleId] : [],
        ),
      ),
    ];
    for (const roleId of customRoleIds) {
      await this.options.grants.deleteRole({
        organizationId: input.organizationId,
        roleId,
        actor: actor(input.callerUserId),
        awaitProjection: input.awaitProjection,
      });
    }
    return publicApiKey(await this.repository.revoke({ id: input.id }));
  }

  private async getInOrganization(id: string, organizationId: string): Promise<StoredApiKey> {
    const row = await this.repository.tryFindByIdInOrganization({
      id,
      organizationId,
    });
    if (!row) {
      throw new ApiKeyNotFoundError(id);
    }
    return row;
  }

  private async validateCreateBindings(input: {
    userId: string | null;
    organizationId: string;
    bindings: ApiKeyScope[];
    permissions: string[] | undefined;
  }): Promise<void> {
    if (input.userId) {
      await this.grants.ensureCallerIsOrgMember({
        userId: input.userId,
        organizationId: input.organizationId,
      });
    }
    for (const binding of input.bindings) {
      await this.grants.validateScope(binding, input.organizationId);
    }
    await this.grants.assertPersonalScopesOwnedBy({
      scopes: input.bindings,
      organizationId: input.organizationId,
      ownerUserId: input.userId,
    });
    if (input.userId) {
      await this.grants.assertCeiling(
        input.userId,
        input.organizationId,
        input.bindings,
        input.permissions ?? [],
      );
    }
  }
}
