import {
  ApiKeyAlreadyRevokedError,
  ApiKeyNotFoundError,
  ApiKeyNotOwnedError,
  ApiKeyReservedNameError,
  ApiKeyScopeViolationError,
  createApiKeyInputSchema,
  type ApiKey,
  type ApiKeyRevocationCause,
  type ApiKeyScope,
  type CreateApiKeyInput,
  type RevokeApiKeyInput,
  type UpdateApiKeyInput,
  API_KEY_PREFIX,
  INGEST_KEY_PREFIX,
  RESERVED_SYSTEM_KEY_NAMES,
  isSystemApiKey,
} from "@langwatch/api-key-contract";
import type { AuthzGrantCaller } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import { fromDate } from "@langwatch/time";
import type { z } from "zod";

import type {
  ApiKeyCreateRecord,
  ApiKeyRepository,
  StoredApiKey,
} from "../repositories/api-key.repository.ts";
import { ApiKeyBindingValidationService } from "./api-key-binding-validation.service.ts";
import type { ApiKeyGrantPolicyService } from "./api-key-grant-policy.service.ts";
import { ApiKeyGrantsService } from "./api-key-grants.service.ts";
import type { ApiKeyTokenResolutionService } from "./api-key-token-resolution.service.ts";
import type { ApiKeyDependencies } from "./api-key.service.ts";

const logger = createLogger("langwatch:api-key:lifecycle");

const RESERVED_NAMES = new Set(RESERVED_SYSTEM_KEY_NAMES);

function publicApiKey(row: StoredApiKey): ApiKey {
  const { hashedSecret: _hashedSecret, ...key } = row;

  return key;
}

type Requester = { userId?: string | null | undefined; apiKeyId?: string | null | undefined };

/** Who answers for a key's grants: the requesting key, else the person, else the system act. */
function grantCaller({ userId, apiKeyId }: Requester): AuthzGrantCaller {
  if (apiKeyId) return { type: "apiKey", id: apiKeyId };

  return userId ? { type: "user", id: userId } : { type: "system" };
}

function actor(userId: string | null | undefined): {
  type: "user" | "system";
  id: string | null;
} {
  return userId ? { type: "user", id: userId } : { type: "system", id: null };
}

/** A key written revoked and not yet granted and activated: its token lives only here. */
export type DisabledApiKey = Readonly<{
  id: string;
  token: string;
  organizationId: string;
  bindings: ApiKeyScope[];
  permissions: string[] | undefined;
  actor: ReturnType<typeof actor>;
  caller: AuthzGrantCaller;
}>;

type PreparedKey = {
  parsed: z.infer<typeof createApiKeyInputSchema>;
  bindings: ApiKeyScope[];
  permissions: string[] | undefined;
};

function disabledKey({
  id,
  token,
  prepared,
}: {
  id: string;
  token: string;
  prepared: PreparedKey;
}): DisabledApiKey {
  const { parsed } = prepared;

  return {
    id,
    token,
    organizationId: parsed.organizationId,
    bindings: prepared.bindings,
    permissions: prepared.permissions,
    actor: actor(parsed.createdByUserId ?? parsed.userId),
    caller: grantCaller({
      userId: parsed.createdByUserId ?? parsed.userId,
      apiKeyId: parsed.callerApiKeyId,
    }),
  };
}

export class ApiKeyLifecycleService {
  static create(
    options: ApiKeyDependencies & { repository: ApiKeyRepository },
    grants: ApiKeyGrantPolicyService,
    answers: Pick<ApiKeyTokenResolutionService, "forget">,
  ): ApiKeyLifecycleService {
    return new ApiKeyLifecycleService({
      repository: options.repository,
      options,
      grants,
      answers,
    });
  }

  private readonly bindings: ApiKeyGrantsService;
  private readonly validation: ApiKeyBindingValidationService;

  private readonly repository: ApiKeyRepository;
  private readonly options: ApiKeyDependencies;
  private readonly grants: ApiKeyGrantPolicyService;
  private readonly answers: Pick<ApiKeyTokenResolutionService, "forget">;

  private constructor({
    repository,
    options,
    grants,
    answers,
  }: {
    repository: ApiKeyRepository;
    options: ApiKeyDependencies;
    grants: ApiKeyGrantPolicyService;
    answers: Pick<ApiKeyTokenResolutionService, "forget">;
  }) {
    this.repository = repository;
    this.options = options;
    this.grants = grants;
    this.answers = answers;
    this.bindings = ApiKeyGrantsService.create({ authz: options.authz });
    this.validation = ApiKeyBindingValidationService.create({ grants });
  }

  async create(input: CreateApiKeyInput): Promise<{ token: string; apiKey: ApiKey }> {
    return this.grantAndActivate(await this.writeDisabled(input));
  }

  /** Validates and writes the key's row revoked; nothing is granted and no token is live yet. */
  async writeDisabled(input: CreateApiKeyInput): Promise<DisabledApiKey> {
    return this.writeRow(await this.prepare(input));
  }

  /**
   * The key an earlier attempt wrote from this same `input`, as `writeDisabled` answered it, so a
   * grant that has not landed can be retried on any server without writing another key.
   */
  async reopenDisabled({
    id,
    token,
    input,
  }: {
    id: string;
    token: string;
    input: CreateApiKeyInput;
  }): Promise<DisabledApiKey> {
    return disabledKey({ id, token, prepared: await this.prepare(input) });
  }

  /**
   * Grants a written key and activates it. A grant that has not landed leaves the row revoked and
   * throws, so the same key may be granted again: its role id and binding identities are its own.
   */
  async grantAndActivate(key: DisabledApiKey): Promise<{ token: string; apiKey: ApiKey }> {
    await this.grants.writeBindings({
      apiKeyId: key.id,
      organizationId: key.organizationId,
      bindings: key.bindings,
      permissions: key.permissions,
      actor: key.actor,
      caller: key.caller,
      roleId: `apikey:${key.id}`,
    });

    return {
      token: key.token,
      apiKey: publicApiKey(
        await this.bindings.attachOne(await this.repository.activate({ id: key.id })),
      ),
    };
  }

  /** Parses and validates a create; the bindings and permissions it would grant. */
  private async prepare(input: CreateApiKeyInput): Promise<PreparedKey> {
    const parsed = createApiKeyInputSchema.parse(input);
    if (!parsed.isSystemManaged && RESERVED_NAMES.has(parsed.name)) {
      throw new ApiKeyReservedNameError(parsed.name);
    }

    const bindings = parsed.bindings;
    const permissions = this.grants.findValidatedPermissions({
      bindings,
      permissionMode: parsed.permissionMode ?? "all",
      permissions: parsed.permissions,
    });
    await this.validation.validateCreate({
      isSystemManaged: parsed.isSystemManaged ?? false,
      userId: parsed.userId ?? null,
      createdByUserId: parsed.createdByUserId ?? null,
      callerApiKeyId: parsed.callerApiKeyId ?? null,
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

    return { parsed, bindings: effectiveBindings, permissions };
  }

  private async writeRow(prepared: PreparedKey): Promise<DisabledApiKey> {
    const { parsed } = prepared;
    const generated = this.options.tokens.generate({
      prefix: parsed.ingestSourceType ? INGEST_KEY_PREFIX : API_KEY_PREFIX,
    });
    const row = await this.repository.create(
      createRecord({
        parsed,
        lookupId: generated.lookupId,
        hashedSecret: generated.hashedSecret,
        grants: prepared.bindings,
      }),
    );

    return disabledKey({ id: row.id, token: generated.token, prepared });
  }

  /** Every pod reads the changed key afresh: its shared answer is deleted right after the write. */
  async update(input: UpdateApiKeyInput): Promise<ApiKey> {
    const existing = await this.getInOrganization(input.id, input.organizationId);
    // A customer key already under a reserved name keeps it; no key may move into one.
    const movesIntoReservedName =
      input.name !== void 0 && input.name !== existing.name && RESERVED_NAMES.has(input.name);
    if (isSystemApiKey(existing) || movesIntoReservedName) {
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
      ? this.grants.findValidatedPermissions({
          bindings: input.bindings ?? [],
          permissionMode: input.permissionMode ?? existing.permissionMode,
          permissions: input.permissions,
        })
      : void 0;
    if (input.bindings) {
      await this.validation.validateUpdate({
        input,
        bindings: input.bindings,
        ownerUserId: existing.userId,
        permissions,
      });
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
            caller: grantCaller({ userId: input.callerUserId, apiKeyId: input.callerApiKeyId }),
            replace: true,
          });

    const updated = await this.repository.update({
      id: input.id,
      name: input.name,
      description: input.description,
      permissionMode: input.permissionMode,
      grants: effectiveBindings,
    });
    await this.answers.forget({ lookupId: existing.lookupId, revoked: false });

    return publicApiKey(await this.bindings.attachOne(updated));
  }

  /** Sets revokedAt, then a refusal as the key's shared answer: dead on every pod at once. */
  async revoke(input: RevokeApiKeyInput): Promise<ApiKey> {
    const existing = await this.getInOrganization(input.id, input.organizationId);
    if (isSystemApiKey(existing)) {
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

    // The row first, then the shared answer, then the grants: a failure part-way leaves a key
    // that is refused, never one that is live with its grants gone.
    const cause = input.cause ?? "user";
    const revoked = publicApiKey({
      ...(await this.repository.revoke({
        id: input.id,
        organizationId: input.organizationId,
        cause,
      })),
      grants: existing.grants,
    });
    await this.answers.forget({ lookupId: existing.lookupId, revoked: true });

    await this.options.grants.revokeBindingsWhere({
      organizationId: input.organizationId,
      where: { apiKeyId: input.id },
      actor: actor(input.callerUserId),
      reason: "api key revoked",
    });
    const customRoleIds = [
      ...new Set(
        existing.grants.flatMap((binding) => (binding.customRoleId ? [binding.customRoleId] : [])),
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

    if (input.cascadeToChildren ?? true) {
      await this.revokeChildrenOf({
        parentApiKeyId: input.id,
        organizationId: input.organizationId,
        callerUserId: input.callerUserId,
        cause,
      });
    }

    return revoked;
  }

  /** Retires the live keys minted under one key and answers how many it retired. */
  revokeChildren(input: {
    parentApiKeyId: string;
    organizationId: string;
    callerUserId: string | null;
    cause: ApiKeyRevocationCause;
  }): Promise<number> {
    return this.revokeChildrenOf(input);
  }

  /** Best effort, never fails the parent's revoke; `callerIsAdmin` is forced true here. */
  private async revokeChildrenOf({
    parentApiKeyId,
    organizationId,
    callerUserId,
    cause,
  }: {
    parentApiKeyId: string;
    organizationId: string;
    callerUserId: string | null;
    cause: ApiKeyRevocationCause;
  }): Promise<number> {
    let children: { id: string }[];
    try {
      children = await this.repository.findLiveChildren({ parentApiKeyId, organizationId });
    } catch (err) {
      logger.warn(
        { err, parentApiKeyId, organizationId },
        "could not read the keys minted under a revoked key",
      );
      return 0;
    }

    // A person's revoke of the parent is not a decision about each child, so
    // the children record that their session went, not that someone chose
    // them. Every other cause describes the session itself and passes down.
    const childCause: ApiKeyRevocationCause = cause === "user" ? "session" : cause;

    let revoked = 0;
    for (const child of children) {
      try {
        await this.revoke({
          id: child.id,
          callerUserId,
          callerIsAdmin: true,
          organizationId,
          awaitProjection: false,
          cause: childCause,
          cascadeToChildren: false,
        });
        revoked += 1;
      } catch (err) {
        if (err instanceof ApiKeyAlreadyRevokedError) continue;
        logger.warn(
          { err, apiKeyId: child.id, parentApiKeyId },
          "could not retire a key minted under a revoked key",
        );
      }
    }
    return revoked;
  }

  private async getInOrganization(id: string, organizationId: string): Promise<StoredApiKey> {
    const row = await this.repository.findByIdInOrganization({
      id,
      organizationId,
    });
    if (!row) {
      throw new ApiKeyNotFoundError(id);
    }

    return this.bindings.attachOne(row);
  }
}

/** The stored row a create writes: disabled until its grants land, then activated. */
function createRecord({
  parsed,
  lookupId,
  hashedSecret,
  grants,
}: {
  parsed: z.output<typeof createApiKeyInputSchema>;
  lookupId: string;
  hashedSecret: string;
  grants: ApiKeyScope[];
}): ApiKeyCreateRecord {
  return {
    name: parsed.name,
    description: parsed.description ?? null,
    lookupId,
    hashedSecret,
    permissionMode: parsed.permissionMode ?? "default",
    userId: parsed.userId ?? null,
    createdByUserId: parsed.createdByUserId ?? null,
    createdByDeviceLabel: parsed.createdByDeviceLabel ?? null,
    parentApiKeyId: parsed.parentApiKeyId ?? null,
    organizationId: parsed.organizationId,
    expiresAt: parsed.expiresAt ? fromDate(parsed.expiresAt) : null,
    ingestSourceType: parsed.ingestSourceType ?? null,
    ingestionTemplateId: parsed.ingestionTemplateId ?? null,
    isSystemManaged: parsed.isSystemManaged ?? false,
    startsDisabled: true,
    grants,
  };
}
