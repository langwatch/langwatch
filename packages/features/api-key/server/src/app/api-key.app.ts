/**
 * The API-key feature's application: what its doors call.
 *
 * It holds the service the feature's api files reach, and it is the one typed
 * thing a transport is given. Before it, `api-key.api.ts` declared its own
 * private `Readonly<{ apiKeys: ApiKeyService }>` — a description of the
 * process's composition that agreed with the process by attention rather than
 * by construction.
 *
 * What lives here as a method is what a door would otherwise have to know, and
 * every one of these was written out per procedure before:
 *
 *   - proving the caller is a member of the organization, which eight
 *     handlers did for themselves;
 *   - asking whether the caller is an organization admin, which four handlers
 *     did for themselves and then acted on differently;
 *   - refusing a service key or a key minted for somebody else to a
 *     non-admin, which was a transport error constructed in the handler;
 *   - deciding which user a new key belongs to.
 *
 * Authorization is deliberately not a declared permission: a personal API key
 * is the caller's own, and no `apiKey:*` permission exists to check. The
 * membership proof below IS the check, which is why it belongs to one
 * operation each rather than to a transport that could forget it.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
 */
import {
  ApiKeyAdminRequiredError,
  type ApiKey,
  type ApiKeyBinding,
  type ApiKeyName,
  type ApiKeyProject,
  type ApiKeyService,
  type ApiKeyTeam,
  type ApiKeyUser,
  type CreateApiKeyInput,
  type UpdateApiKeyInput,
} from "@langwatch/api-key-contract";

/** Who an operation is performed by, and whose membership is proved. */
export interface ApiKeyCaller {
  readonly id: string;
}

/** What the process composes this feature's application from. */
export interface ApiKeyAppDependencies {
  apiKeys: ApiKeyService;
}

/** One of the caller's own bindings, with the scope named rather than only identified. */
export type NamedApiKeyBinding = ApiKeyBinding & {
  scopeName: string | null;
  customRoleName: string | null;
};

/** What a key may create: the caller's own personal key, or an admin's key. */
export type CreateApiKeyRequest = Readonly<{
  organizationId: string;
  name: string;
  description?: string | undefined;
  expiresAt?: Date | undefined;
  permissionMode: string;
  keyType: "personal" | "service";
  assignedToUserId?: string | undefined;
  permissions?: CreateApiKeyInput["permissions"];
  bindings: CreateApiKeyInput["bindings"];
}>;

export type UpdateApiKeyRequest = Readonly<{
  organizationId: string;
  apiKeyId: string;
  name?: string | undefined;
  description?: string | null | undefined;
  permissionMode?: UpdateApiKeyInput["permissionMode"];
  permissions?: UpdateApiKeyInput["permissions"];
  bindings?: UpdateApiKeyInput["bindings"];
}>;

export class ApiKeyApp {
  static create(dependencies: ApiKeyAppDependencies): ApiKeyApp {
    return new ApiKeyApp(dependencies);
  }

  private constructor(private readonly dependencies: ApiKeyAppDependencies) {}

  /**
   * The service itself, for the one thing this application deliberately is not
   * about: turning a credential on the wire into a caller.
   *
   * Everything below is the MANAGEMENT surface — a signed-in member listing,
   * minting and retiring keys in an organization they belong to. Resolving an
   * inbound token (`tryResolveToken`, `markUsed`) is the opposite direction:
   * it runs before anyone is authenticated, so there is no `by` to prove
   * membership for, and it is what the Hono auth middleware and every
   * key-authenticated REST family call on the way in. The CLI device-login
   * lifecycle (`mintCliLoginKey`, `validateCliSelection`,
   * `tryResolveDefaultCliSelection`, `revokeCliLoginKeysForDevice`) sits on the
   * same seam: those run against a device grant, not a session.
   *
   * Modelling either as an operation here would mean this application
   * answering "who is calling?" for its own callers, so the getter is the seam
   * that remains — the same one `ModelProviderApp.providerService` keeps.
   */
  get apiKeyService(): ApiKeyService {
    return this.dependencies.apiKeys;
  }

  /**
   * The caller's own bindings in one organization, each with its scope named.
   *
   * Bindings on archived projects are dropped: the drawers mirror this list to
   * cap what a new key may be given, and a scope that no longer exists is not
   * something a key should be able to name.
   */
  async listCallerBindings(
    input: Readonly<{ organizationId: string }>,
    by: ApiKeyCaller,
  ): Promise<NamedApiKeyBinding[]> {
    await this.ensureMember(input.organizationId, by);
    const bindings = await this.dependencies.apiKeys.getUserBindings({
      userId: by.id,
      organizationId: input.organizationId,
    });

    const { orgName, teamName, activeProjectIds, projectName, customRoleName } =
      await this.dependencies.apiKeys.enrichBindingsWithNames({ bindings });

    return bindings
      .filter((b) => b.scopeType !== "PROJECT" || activeProjectIds.has(b.scopeId))
      .map((b) => ({
        ...b,
        scopeName:
          b.scopeType === "ORGANIZATION"
            ? (orgName.get(b.scopeId) ?? null)
            : b.scopeType === "TEAM"
              ? (teamName.get(b.scopeId) ?? null)
              : (projectName.get(b.scopeId) ?? null),
        customRoleName: b.customRoleId ? (customRoleName.get(b.customRoleId) ?? null) : null,
      }));
  }

  /**
   * One key id resolved to a display name, for a caller who already has the id.
   *
   * Answers null identically for an id that does not exist and one that
   * belongs to another organization, so it cannot be used to enumerate.
   */
  async getKeyName(
    input: Readonly<{ organizationId: string; apiKeyId: string }>,
    by: ApiKeyCaller,
  ): Promise<ApiKeyName | null> {
    await this.ensureMember(input.organizationId, by);
    return this.dependencies.apiKeys.tryGetNameByIdInOrg({
      id: input.apiKeyId,
      organizationId: input.organizationId,
    });
  }

  /**
   * The organization's keys for an admin, the caller's own for everyone else.
   *
   * Never the secret: a key is identified by the first five characters of its
   * lookup id, which is enough to recognise one and not enough to use it.
   */
  async listKeys(input: Readonly<{ organizationId: string }>, by: ApiKeyCaller) {
    await this.ensureMember(input.organizationId, by);
    const callerIsAdmin = await this.isOrganizationAdmin(input.organizationId, by);

    const apiKeys = callerIsAdmin
      ? await this.dependencies.apiKeys.listAll({ organizationId: input.organizationId })
      : await this.dependencies.apiKeys.list({
          userId: by.id,
          organizationId: input.organizationId,
        });

    const allBindings = apiKeys.flatMap((k) => k.roleBindings);
    // Only the custom-role half of the enrichment is read here: a key row
    // renders its scope ids, not their names.
    const { customRoleName, customRoles } =
      await this.dependencies.apiKeys.enrichBindingsWithNames({
        bindings: allBindings.map((rb): ApiKeyBinding => ({
          id: rb.id,
          role: rb.role,
          customRoleId: rb.customRoleId ?? null,
          scopeType: rb.scopeType,
          scopeId: rb.scopeId,
        })),
      });

    const customRolePermissions = new Map(
      customRoles.map((r) => [r.id, Array.isArray(r.permissions) ? r.permissions : []]),
    );

    const { users } = await this.dependencies.apiKeys.enrichApiKeyList({ apiKeys });
    const userName = new Map(users.map((u) => [u.id, u.name ?? u.email]));
    const userEmail = new Map(users.map((u) => [u.id, u.email]));

    return apiKeys.map((apiKey) => ({
      id: apiKey.id,
      lookupIdPrefix: apiKey.lookupId.slice(0, 5),
      name: apiKey.name,
      description: apiKey.description,
      permissionMode: apiKey.permissionMode,
      userId: apiKey.userId,
      userName: apiKey.userId ? (userName.get(apiKey.userId) ?? null) : null,
      userEmail: apiKey.userId ? (userEmail.get(apiKey.userId) ?? null) : null,
      createdByUserId: apiKey.createdByUserId,
      createdByUserName: apiKey.createdByUserId
        ? (userName.get(apiKey.createdByUserId) ?? null)
        : null,
      createdAt: apiKey.createdAt,
      expiresAt: apiKey.expiresAt,
      lastUsedAt: apiKey.lastUsedAt,
      revokedAt: apiKey.revokedAt,
      // Non-null marks this as an ingestion key (project-scoped, ingest-only
      // write credential the `langwatch <tool>` CLI mints). null = regular
      // personal / service key. Drives the API Keys page section split.
      ingestSourceType: apiKey.ingestSourceType,
      ingestionTemplateId: apiKey.ingestionTemplateId,
      // Human label of the CLI device session that minted this ingestion key
      // ("Rogerio's MacBook Pro"); null for keys without device provenance.
      createdByDeviceLabel: apiKey.createdByDeviceLabel,
      roleBindings: apiKey.roleBindings.map((rb) => ({
        id: rb.id,
        role: rb.role,
        customRoleId: rb.customRoleId ?? null,
        customRoleName: rb.customRoleId ? (customRoleName.get(rb.customRoleId) ?? null) : null,
        customRolePermissions: rb.customRoleId
          ? (customRolePermissions.get(rb.customRoleId) ?? null)
          : null,
        scopeType: rb.scopeType,
        scopeId: rb.scopeId,
      })),
    }));
  }

  /**
   * Mints a key and hands back its plaintext token — once, here, and nowhere
   * else. Nothing stores it and no read returns it, so a caller who loses it
   * revokes and mints again.
   *
   * Who the key belongs to is decided here rather than by a door: a service
   * key belongs to nobody, an unassigned personal key belongs to its creator,
   * and assigning one to somebody else takes organization admin.
   */
  async createKey(
    input: CreateApiKeyRequest,
    by: ApiKeyCaller,
  ): Promise<{ token: string; apiKey: ApiKey; assignedToUserId: string | null }> {
    await this.ensureMember(input.organizationId, by);
    const isService = input.keyType === "service";

    if (isService || (input.assignedToUserId && input.assignedToUserId !== by.id)) {
      if (!(await this.isOrganizationAdmin(input.organizationId, by))) {
        throw new ApiKeyAdminRequiredError(
          isService ? "create-service-key" : "assign-to-another-user",
        );
      }
    }

    const assignedToUserId = isService ? null : (input.assignedToUserId ?? by.id);
    const { token, apiKey } = await this.dependencies.apiKeys.create({
      name: input.name,
      description: input.description,
      userId: assignedToUserId,
      createdByUserId: by.id,
      organizationId: input.organizationId,
      expiresAt: input.expiresAt,
      permissionMode: input.permissionMode,
      permissions: input.permissions,
      bindings: input.bindings,
    });

    return { token, apiKey, assignedToUserId };
  }

  /** Rewrites a key's name, description, permissions and bindings. */
  async updateKey(input: UpdateApiKeyRequest, by: ApiKeyCaller): Promise<ApiKey> {
    await this.ensureMember(input.organizationId, by);
    const callerIsAdmin = await this.isOrganizationAdmin(input.organizationId, by);

    return this.dependencies.apiKeys.update({
      id: input.apiKeyId,
      callerUserId: by.id,
      callerIsAdmin,
      organizationId: input.organizationId,
      name: input.name,
      description: input.description,
      permissionMode: input.permissionMode,
      permissions: input.permissions,
      bindings: input.bindings,
    });
  }

  /** Retires a key. An admin may retire anyone's; everyone else their own. */
  async revokeKey(
    input: Readonly<{ organizationId: string; apiKeyId: string }>,
    by: ApiKeyCaller,
  ): Promise<void> {
    await this.ensureMember(input.organizationId, by);
    const callerIsAdmin = await this.isOrganizationAdmin(input.organizationId, by);

    await this.dependencies.apiKeys.revoke({
      id: input.apiKeyId,
      callerUserId: by.id,
      callerIsAdmin,
      organizationId: input.organizationId,
    });
  }

  /** The organization's projects, for the restricted-permission picker. */
  async listOrganizationProjects(
    input: Readonly<{ organizationId: string }>,
    by: ApiKeyCaller,
  ): Promise<ApiKeyProject[]> {
    await this.ensureMember(input.organizationId, by);
    return this.dependencies.apiKeys.getOrgProjects({ organizationId: input.organizationId });
  }

  /** The organization's teams, for the scope picker. */
  async listOrganizationTeams(
    input: Readonly<{ organizationId: string }>,
    by: ApiKeyCaller,
  ): Promise<ApiKeyTeam[]> {
    await this.ensureMember(input.organizationId, by);
    return this.dependencies.apiKeys.getOrgTeams({ organizationId: input.organizationId });
  }

  /**
   * The organization's members, for assigning a key to one of them.
   *
   * Empty for a non-admin rather than refused: only an admin can assign a key
   * to somebody else, so a non-admin has nobody to pick from and the picker is
   * simply not offered.
   */
  async listOrganizationMembers(
    input: Readonly<{ organizationId: string }>,
    by: ApiKeyCaller,
  ): Promise<ApiKeyUser[]> {
    await this.ensureMember(input.organizationId, by);
    if (!(await this.isOrganizationAdmin(input.organizationId, by))) return [];
    return this.dependencies.apiKeys.getOrgMembers({ organizationId: input.organizationId });
  }

  private ensureMember(organizationId: string, by: ApiKeyCaller): Promise<void> {
    return this.dependencies.apiKeys.ensureCallerIsOrgMember({
      userId: by.id,
      organizationId,
    });
  }

  private isOrganizationAdmin(organizationId: string, by: ApiKeyCaller): Promise<boolean> {
    return this.dependencies.apiKeys.isOrgAdmin({ userId: by.id, organizationId });
  }
}
