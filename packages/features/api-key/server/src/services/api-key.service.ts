import {
  ApiKeyAlreadyRevokedError,
  ApiKeyNotFoundError,
  ApiKeyNotOwnedError,
  ApiKeyReservedNameError,
  ApiKeyScopeViolationError,
  CliKeySelectionInvalidError,
  ProjectVisibilityTooWideError,
} from "@langwatch/api-key-contract";
import { ALL_PERMISSIONS, isRegistryPermission, type AuthzGrantsService, type AuthzPermission, type AuthzService } from "@langwatch/authz-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { ApiKeyService as ApiKeyCapability, apiKeyPermissionSchema, apiKeyTokenResolutionInputSchema, apiKeyVisibleProjectsInputSchema, cliKeySelectionSchema, createApiKeyInputSchema, getTokenType, organizationApiKeyResolutionInputSchema, organizationApiKeyResolutionSchema, resolvedApiKeyTokenSchema, type ApiKey, type ApiKeyBinding, type ApiKeyBindingNames, type ApiKeyDetail, type ApiKeyListEnrichment, type ApiKeyName, type ApiKeyProject, type ApiKeyRoleSummary, type ApiKeyScope, type ApiKeyTeam, type ApiKeyUser, type ApiKeyVisibleProjects, type CliKeyScopeSummary, type CliKeySelection, type CreateApiKeyInput, type OrganizationApiKeyResolution, type ResolvedApiKeyToken, type RevokeApiKeyInput, type UpdateApiKeyInput, API_KEY_PREFIX, INGEST_KEY_PREFIX, HIDDEN_SYSTEM_KEY_NAMES, LANGY_SESSION_API_KEY_NAME } from "@langwatch/api-key-contract";
import type { ApiKeyTokenPort } from "../ports/api-key-token.port";
import type { ApiKeyRepository, StoredApiKey } from "../repositories/api-key.repository";
import type { LegacyApiKeyGrantService } from "./legacy-api-key-grant.service";

const SYSTEM_NAMES = new Set(HIDDEN_SYSTEM_KEY_NAMES);
const MAX_VISIBLE_PROJECT_CANDIDATES = 5_000;

export type ApiKeyDependencies = {
  authz: AuthzService;
  grants: AuthzGrantsService;
  organizations: OrganizationService;
  projects: ProjectService;
  newBindingId: () => string;
  legacyGrants: LegacyApiKeyGrantService;
  tokens: ApiKeyTokenPort;
};

function publicKey(row: StoredApiKey): ApiKey { const { hashedSecret: _hashedSecret, ...key } = row; return key; }
function actor(userId: string | null | undefined): { type: "user" | "system"; id: string | null } { return userId ? { type: "user", id: userId } : { type: "system", id: null }; }
function isListedForMember(key: ApiKey, userId: string | null): boolean { return !!userId && (key.userId === userId || (key.userId === null && key.ingestSourceType === null)); }
type ResolvedScope = { type: "organization" | "team" | "project"; id: string; teamId?: string; organizationId: string };

/** Complete API-key aggregate. All persistence and feature collaborators are injected at construction. */
export class ApiKeyService extends ApiKeyCapability {
  constructor(
    private readonly repository: ApiKeyRepository,
    private readonly options: ApiKeyDependencies,
  ) {
    super();
  }

  static create(options: ApiKeyDependencies & { repository: ApiKeyRepository }): ApiKeyService {
    return new ApiKeyService(options.repository, options);
  }

  async create(input: CreateApiKeyInput): Promise<{ token: string; apiKey: ApiKey }> {
    const parsed = createApiKeyInputSchema.parse(input);
    if (!parsed.isSystemManaged && SYSTEM_NAMES.has(parsed.name)) throw new ApiKeyReservedNameError(parsed.name);
    const bindings = parsed.bindings;
    const permissions = this.validatePermissionSelection({
      bindings,
      permissionMode: parsed.permissionMode ?? "all",
      permissions: parsed.permissions,
    });
    if (parsed.userId) await this.ensureCallerIsOrgMember({ userId: parsed.userId, organizationId: parsed.organizationId });
    for (const binding of bindings) await this.validateScope(binding, parsed.organizationId);
    await this.assertPersonalScopesOwnedBy({ scopes: bindings, organizationId: parsed.organizationId, ownerUserId: parsed.userId ?? null });
    if (parsed.userId) await this.assertCeiling(parsed.userId, parsed.organizationId, bindings, permissions ?? []);
    const effectiveBindings = parsed.userId || bindings.length ? bindings : [{ scopeType: "ORGANIZATION" as const, scopeId: parsed.organizationId, role: "ADMIN" as const }];
    if (parsed.userId && effectiveBindings.length === 0) throw new ApiKeyScopeViolationError("A personal API key needs at least one role binding");
    const generated = this.options.tokens.generate({
      prefix: parsed.ingestSourceType ? INGEST_KEY_PREFIX : API_KEY_PREFIX,
    });
    const row = await this.repository.create({ name: parsed.name, description: parsed.description ?? null, lookupId: generated.lookupId, hashedSecret: generated.hashedSecret, permissionMode: parsed.permissionMode ?? "default", userId: parsed.userId ?? null, createdByUserId: parsed.createdByUserId ?? null, createdByDeviceLabel: parsed.createdByDeviceLabel ?? null, organizationId: parsed.organizationId, expiresAt: parsed.expiresAt ?? null, ingestSourceType: parsed.ingestSourceType ?? null, ingestionTemplateId: parsed.ingestionTemplateId ?? null, startsDisabled: true, roleBindings: effectiveBindings });
    await this.writeBindings({ apiKeyId: row.id, organizationId: parsed.organizationId, bindings: effectiveBindings, permissions, actor: actor(parsed.createdByUserId ?? parsed.userId), roleId: `apikey:${row.id}` });
    return { token: generated.token, apiKey: publicKey(await this.repository.activate({ id: row.id })) };
  }

  async update(input: UpdateApiKeyInput): Promise<ApiKey> {
    const existing = await this.getInOrganization(input.id, input.organizationId);
    if (SYSTEM_NAMES.has(existing.name) || (input.name !== undefined && SYSTEM_NAMES.has(input.name))) throw new ApiKeyNotFoundError(input.id);
    if (!input.callerIsAdmin && (existing.userId === null || existing.userId !== input.callerUserId)) throw new ApiKeyNotOwnedError(input.id);
    if (existing.revokedAt) throw new ApiKeyAlreadyRevokedError(input.id);
    const hasPermissionUpdate =
      input.bindings !== undefined ||
      input.permissionMode !== undefined ||
      input.permissions !== undefined;
    const permissions = hasPermissionUpdate
      ? this.validatePermissionSelection({
          bindings: input.bindings ?? [],
          permissionMode: input.permissionMode ?? existing.permissionMode,
          permissions: input.permissions,
        })
      : undefined;
    if (input.bindings) { for (const binding of input.bindings) await this.validateScope(binding, input.organizationId); await this.assertPersonalScopesOwnedBy({ scopes: input.bindings, organizationId: input.organizationId, ownerUserId: existing.userId }); if (existing.userId) await this.assertCeiling(existing.userId, input.organizationId, input.bindings, permissions ?? []); }
    const effectiveBindings = await this.writeBindings({ apiKeyId: input.id, organizationId: input.organizationId, bindings: input.bindings, permissions, actor: actor(input.callerUserId), replace: true });
    return publicKey(await this.repository.update({ id: input.id, name: input.name, description: input.description, permissionMode: input.permissionMode, roleBindings: effectiveBindings }));
  }

  async tryVerify({ token }: { token: string }): Promise<import("@langwatch/api-key-contract").ApiKeyVerification | null> {
    const split = this.trySplitToken(token); if (!split) return null;
    const row = await this.repository.tryFindByLookupId({ lookupId: split.lookupId }); if (!row || row.revokedAt || (row.expiresAt !== null && row.expiresAt < new Date())) return null;
    const verification = this.options.tokens.verify(split.secret, row.hashedSecret);
    if (verification === "no_match") return null;
    if (verification === "match_legacy") void this.repository.upgradeHash({ id: row.id, hashedSecret: this.options.tokens.hash(split.secret) }).catch(() => undefined);
    this.options.legacyGrants.mint(publicKey(row));
    return { ...publicKey(row), tokenType: "apiKey" };
  }

  async tryResolveToken(input: {
    token: string;
    projectId?: string | null;
  }): Promise<ResolvedApiKeyToken | null> {
    const parsed = apiKeyTokenResolutionInputSchema.parse(input);
    const tokenType = getTokenType(parsed.token);

    if (tokenType === "legacyProjectKey") {
      return this.tryResolveLegacyProjectKey(parsed.token);
    }

    if (tokenType === "apiKey") {
      const resolved = await this.tryResolveCurrentApiKey(
        parsed.token,
        parsed.projectId ?? null,
      );
      if (resolved) return resolved;
      if (parsed.token.startsWith(API_KEY_PREFIX)) {
        return this.tryResolveLegacyProjectKey(parsed.token);
      }
      return null;
    }

    return this.tryResolveLegacyProjectKey(parsed.token);
  }

  async regenerateLegacyProjectKey(input: { projectId: string }): Promise<string> {
    const token = this.options.tokens.generateLegacyProjectKey();
    const rotated = await this.repository.rotateLegacyProjectKey({
      projectId: input.projectId,
      token,
    });
    if (!rotated) throw new ApiKeyNotFoundError(input.projectId);
    return token;
  }

  async resolveOrganizationToken(input: {
    token: string;
  }): Promise<OrganizationApiKeyResolution> {
    const parsed = organizationApiKeyResolutionInputSchema.parse(input);
    if (getTokenType(parsed.token) === "apiKey") {
      const apiKey = await this.tryVerify({ token: parsed.token });
      if (apiKey) {
        return organizationApiKeyResolutionSchema.parse({
          ok: true,
          resolved: {
            type: "apiKey-org",
            apiKeyId: apiKey.id,
            userId: apiKey.userId,
            organizationId: apiKey.organizationId,
          },
        });
      }
    }

    const legacy = await this.tryResolveLegacyProjectKey(parsed.token);
    return organizationApiKeyResolutionSchema.parse(
      legacy
        ? { ok: false, reason: "wrong_credential_class" }
        : { ok: false, reason: "unusable_credential" },
    );
  }

  async resolveVisibleProjects(input: {
    apiKeyId: string;
    organizationId: string;
  }): Promise<ApiKeyVisibleProjects> {
    const parsed = apiKeyVisibleProjectsInputSchema.parse(input);
    const key = await this.repository.tryFindByIdInOrganization({
      id: parsed.apiKeyId,
      organizationId: parsed.organizationId,
    });
    if (!key) return { kind: "some", ids: [] };

    const principal = { type: "apiKey" as const, id: key.id };
    const organizationWide = await this.options.authz.can({
      principal,
      permission: "project:view",
      scope: { type: "organization", id: parsed.organizationId },
    });
    if (organizationWide) return { kind: "all" };

    const teamIds = [
      ...new Set(
        key.roleBindings.flatMap((binding) =>
          binding.scopeType === "TEAM" ? [binding.scopeId] : [],
        ),
      ),
    ];
    const projectIds = [
      ...new Set(
        key.roleBindings.flatMap((binding) =>
          binding.scopeType === "PROJECT" ? [binding.scopeId] : [],
        ),
      ),
    ];
    const candidates = await this.options.projects.listActiveByScopes({
      organizationId: parsed.organizationId,
      organizationWide: key.roleBindings.some(
        (binding) => binding.scopeType === "ORGANIZATION",
      ),
      teamIds,
      projectIds,
      limit: MAX_VISIBLE_PROJECT_CANDIDATES,
    });
    if (candidates.hasMore) {
      throw new ProjectVisibilityTooWideError(
        `Resolving this credential's project visibility would scan more than ${MAX_VISIBLE_PROJECT_CANDIDATES} projects`,
        {
          meta: {
            organizationId: parsed.organizationId,
            limit: MAX_VISIBLE_PROJECT_CANDIDATES,
          },
        },
      );
    }
    if (candidates.data.length === 0) return { kind: "some", ids: [] };

    const decision = await this.options.authz.canBatchByIds({
      principal,
      permission: "project:view",
      organizationId: parsed.organizationId,
      teams: [],
      projects: candidates.data.map((project) => ({
        projectId: project.id,
        teamId: project.teamId,
      })),
    });
    return {
      kind: "some",
      ids: candidates.data
        .filter((project) => decision.projects.get(project.id) === true)
        .map((project) => project.id),
    };
  }

  markUsed({ id }: { id: string }): void { void this.repository.updateLastUsedAt({ id }).catch(() => undefined); }
  async list(input: { userId: string; organizationId: string }): Promise<ApiKey[]> { return (await this.repository.listForUser(input)).map(publicKey); }
  async listAll({ organizationId }: { organizationId: string }): Promise<ApiKey[]> { return (await this.repository.listForOrganization({ organizationId })).map(publicKey); }

  async revoke(input: RevokeApiKeyInput): Promise<ApiKey> {
    const existing = await this.getInOrganization(input.id, input.organizationId); if (SYSTEM_NAMES.has(existing.name)) throw new ApiKeyNotFoundError(input.id);
    if (!input.callerIsAdmin && (existing.userId === null || existing.userId !== input.callerUserId)) throw new ApiKeyNotOwnedError(input.id);
    if (existing.revokedAt) throw new ApiKeyAlreadyRevokedError(input.id);
    await this.options.grants.revokeBindingsWhere({ organizationId: input.organizationId, where: { apiKeyId: input.id }, actor: actor(input.callerUserId), reason: "api key revoked" });
    const customRoleIds = [...new Set(existing.roleBindings.flatMap((binding) => binding.customRoleId ? [binding.customRoleId] : []))];
    for (const roleId of customRoleIds) await this.options.grants.deleteRole({ organizationId: input.organizationId, roleId, actor: actor(input.callerUserId), awaitProjection: input.awaitProjection });
    return publicKey(await this.repository.revoke({ id: input.id }));
  }

  async ensureCallerIsOrgMember(input: { userId: string; organizationId: string }): Promise<void> {
    const allowed = await this.options.authz.hasPermission({ userId: input.userId, organizationId: input.organizationId, permission: "organization:view" });
    if (!allowed) throw new ApiKeyScopeViolationError("Not a member of this organization");
  }

  async assertSelectionWithinCeiling(input: { userId: string; organizationId: string; bindings: Array<ApiKeyScope & { role: "CUSTOM" }>; permissions: string[] }): Promise<void> { await this.ensureCallerIsOrgMember(input); for (const binding of input.bindings) await this.validateScope(binding, input.organizationId); await this.assertCeiling(input.userId, input.organizationId, input.bindings, input.permissions); }
  async isOrgAdmin(input: { userId: string; organizationId: string }): Promise<boolean> { return (await this.options.authz.listUserBindings(input)).some((binding) => binding.scopeType === "ORGANIZATION" && binding.scopeId === input.organizationId && binding.role === "ADMIN"); }
  async isOrgAdminApiKey(input: { apiKeyId: string; organizationId: string }): Promise<boolean> { return (await this.options.authz.listScopeBindings({ organizationId: input.organizationId, scopeType: "ORGANIZATION", scopeIds: [input.organizationId] })).some((binding) => binding.apiKeyId === input.apiKeyId && binding.role === "ADMIN"); }
  async tryGetById({ id }: { id: string }): Promise<ApiKey | null> { const row = await this.repository.tryFindById({ id }); return row ? publicKey(row) : null; }
  async getByIdForCaller(input: { id: string; organizationId: string; callerUserId: string | null; callerCanReadAnyKey: boolean }): Promise<ApiKeyDetail> { const row = await this.getInOrganization(input.id, input.organizationId); if (SYSTEM_NAMES.has(row.name) || (!input.callerCanReadAnyKey && !isListedForMember(row, input.callerUserId))) throw new ApiKeyNotFoundError(input.id); return { ...publicKey(row), permissions: await this.customPermissions(row, input.organizationId) }; }
  async tryGetNameByIdInOrg(input: { id: string; organizationId: string }): Promise<ApiKeyName | null> { const row = await this.repository.tryFindByIdInOrganization(input); return row ? { name: row.name, revoked: row.revokedAt !== null } : null; }
  async getUserBindings(input: { userId: string; organizationId: string }): Promise<ApiKeyBinding[]> { return (await this.options.authz.listUserBindings(input)).map((binding) => ({ id: binding.id, role: binding.role, customRoleId: binding.customRoleId, scopeType: binding.scopeType, scopeId: binding.scopeId })); }
  async getOrgProjects({ organizationId }: { organizationId: string }): Promise<ApiKeyProject[]> { return (await this.options.projects.listByOrganization({ organizationId, page: 1, limit: 1000 })).data.map((project) => ({ id: project.id, name: project.name, teamId: project.teamId })); }
  async getOrgTeams({ organizationId }: { organizationId: string }): Promise<ApiKeyTeam[]> { return (await this.options.organizations.listTeams({ organizationId, page: 1, limit: 1000 })).data.map((team) => ({ id: team.id, name: team.name })); }
  async getOrgMembers({ organizationId }: { organizationId: string }): Promise<ApiKeyUser[]> { const members = new Map<string, ApiKeyUser>(); for (const binding of await this.options.authz.listOrganizationBindings({ organizationId })) if (binding.user) members.set(binding.user.id, { id: binding.user.id, name: binding.user.name, email: binding.user.email }); return [...members.values()]; }
  async tryGetIngestionKey(input: { organizationId: string; projectId: string; sourceType: string }): Promise<ApiKey | null> { const row = await this.repository.tryFindIngestKey(input); return row ? publicKey(row) : null; }
  async listIngestionKeysForProject(input: { organizationId: string; projectId: string }): Promise<ApiKey[]> { return (await this.repository.findIngestKeysForProject(input)).map(publicKey); }
  async validateCliSelection(input: { userId: string; organizationId: string; selection: CliKeySelection }): Promise<CliKeySelection> {
    const selection = cliKeySelectionSchema.parse(input.selection);
    const bindings = [...new Map(selection.bindings.map((binding) => [`${binding.scopeType}:${binding.scopeId}`, binding])).values()];
    if (bindings.length === 0) throw new CliKeySelectionInvalidError({ bindings: ["Select at least one scope"] });
    const unknown = selection.permissions.filter((permission) => !isRegistryPermission(permission));
    if (unknown.length > 0) throw new CliKeySelectionInvalidError({ permissions: unknown.map((permission) => `Unknown permission "${permission}"`) });
    const permissions = [...new Set(selection.permissions)].filter((permission) => bindings.some((binding) => binding.scopeType === "ORGANIZATION") || !["organization:manage", "organization:delete", "team:manage"].includes(permission));
    if (permissions.length === 0) throw new CliKeySelectionInvalidError({ permissions: ["Select at least one permission"] });
    await this.assertSelectionWithinCeiling({ userId: input.userId, organizationId: input.organizationId, bindings: bindings.map((binding) => ({ ...binding, role: "CUSTOM" as const })), permissions });
    return { bindings, permissions: permissions.sort() };
  }

  async tryResolveDefaultCliSelection(input: { userId: string; organizationId: string }): Promise<CliKeySelection | null> {
    const defaults = ALL_PERMISSIONS.filter((permission) => !["organization:manage", "organization:delete", "team:manage"].includes(permission)) as AuthzPermission[];
    if (await this.isOrgAdmin(input)) return { bindings: [{ scopeType: "ORGANIZATION", scopeId: input.organizationId }], permissions: [...defaults].sort() };
    const bindings = await this.options.authz.listUserBindings(input);
    const teamIds = [...new Set(bindings.filter((binding) => binding.scopeType === "TEAM").map((binding) => binding.scopeId))];
    const heldByTeam = new Map<string, string[]>();
    for (const teamId of teamIds) {
      const personal = await this.repository.tryFindPersonalWorkspaceOwner({ organizationId: input.organizationId, scopeId: teamId });
      if (personal && personal.ownerUserId !== input.userId) continue;
      const held = await this.options.authz.effectivePermissions({ principal: { type: "user", id: input.userId }, scope: { type: "team", id: teamId, organizationId: input.organizationId } });
      const selected = defaults.filter((permission) => held.includes(permission));
      if (selected.length > 0) heldByTeam.set(teamId, selected);
    }
    let permissions: string[] | null = null;
    const selectedTeams: string[] = [];
    for (const [teamId, held] of heldByTeam) { selectedTeams.push(teamId); permissions = permissions === null ? held : permissions.filter((permission) => held.includes(permission)); }
    if (!permissions || permissions.length === 0) return null;
    return { bindings: selectedTeams.map((scopeId) => ({ scopeType: "TEAM" as const, scopeId })), permissions: permissions.sort() };
  }

  async mintCliLoginKey(input: { userId: string; organizationId: string; deviceLabel: string; selection: CliKeySelection }): Promise<{ token: string; apiKeyId: string; scope: CliKeyScopeSummary }> {
    const scope = await this.resolveCliScopeSummary({ organizationId: input.organizationId, bindings: input.selection.bindings });
    const created = await this.create({ name: `CLI login - ${input.deviceLabel}`, userId: input.userId, createdByUserId: input.userId, organizationId: input.organizationId, permissionMode: "restricted", permissions: input.selection.permissions, bindings: input.selection.bindings.map((binding) => ({ ...binding, role: "CUSTOM" as const })), createdByDeviceLabel: input.deviceLabel });
    try {
      await this.revokeCliLoginKeysForDevice({ userId: input.userId, organizationId: input.organizationId, deviceLabel: input.deviceLabel, exceptApiKeyId: created.apiKey.id, createdBefore: created.apiKey.createdAt });
    } catch (error) {
      await this.revoke({ id: created.apiKey.id, callerUserId: input.userId, callerIsAdmin: false, organizationId: input.organizationId }).catch(() => undefined);
      throw error;
    }
    return { token: created.token, apiKeyId: created.apiKey.id, scope };
  }

  async revokeCliLoginKeysForDevice(input: { userId: string; organizationId: string; deviceLabel: string; exceptApiKeyId?: string; createdBefore?: Date }): Promise<void> {
    const keys = await this.repository.listForUser({ userId: input.userId, organizationId: input.organizationId });
    for (const key of keys) {
      if (!key.name.startsWith("CLI login - ") || key.createdByDeviceLabel !== input.deviceLabel || key.id === input.exceptApiKeyId || (input.createdBefore && key.createdAt >= input.createdBefore)) continue;
      await this.revoke({ id: key.id, callerUserId: input.userId, callerIsAdmin: false, organizationId: input.organizationId });
    }
  }

  async revokeCliLoginKeyForLogout(input: { apiKeyId: string; userId: string; organizationId: string }): Promise<void> {
    try { await this.revoke({ id: input.apiKeyId, callerUserId: input.userId, callerIsAdmin: false, organizationId: input.organizationId }); } catch (error) { if (error instanceof ApiKeyNotFoundError || error instanceof ApiKeyAlreadyRevokedError) return; throw error; }
  }

  private async resolveCliScopeSummary(input: { organizationId: string; bindings: Array<{ scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }> }): Promise<CliKeyScopeSummary> {
    if (input.bindings.some((binding) => binding.scopeType === "ORGANIZATION")) return { kind: "organization", projectIds: [] };
    const teamIds = input.bindings.filter((binding) => binding.scopeType === "TEAM").map((binding) => binding.scopeId);
    const projectIds = input.bindings.filter((binding) => binding.scopeType === "PROJECT").map((binding) => binding.scopeId);
    const projects = (await this.options.projects.listByOrganization({ organizationId: input.organizationId, page: 1, limit: 1000 })).data.filter((project) => projectIds.includes(project.id) || teamIds.includes(project.teamId));
    return { kind: "projects", projectIds: projects.map((project) => project.id).sort() };
  }
  async enrichBindingsWithNames({
    bindings,
    organizationId,
  }: {
    bindings: ApiKeyBinding[];
    organizationId?: string;
  }): Promise<ApiKeyBindingNames> {
    const orgName = new Map<string, string>();
    const teamName = new Map<string, string>();
    const projectName = new Map<string, string>();
    const activeProjectIds = new Set<string>();
    const customRoleName = new Map<string, string>();
    const resolvedOrganizationId =
      organizationId ??
      bindings.find((binding) => binding.scopeType === "ORGANIZATION")?.scopeId;
    const customRoles = resolvedOrganizationId
      ? await this.customRoles(
          [
            ...new Set(
              bindings.flatMap((binding) =>
                binding.customRoleId ? [binding.customRoleId] : [],
              ),
            ),
          ],
          resolvedOrganizationId,
        )
      : [];

    for (const role of customRoles) customRoleName.set(role.id, role.name);
    for (const binding of bindings) {
      if (binding.scopeType === "ORGANIZATION") {
        const organization = await this.options.organizations.getBillingProfile(
          { organizationId: binding.scopeId },
        );
        orgName.set(binding.scopeId, organization.name);
      }
      if (binding.scopeType === "TEAM" && resolvedOrganizationId) {
        const team = await this.options.organizations.getTeam({
          organizationId: resolvedOrganizationId,
          teamId: binding.scopeId,
        });
        teamName.set(binding.scopeId, team.name);
      }
      if (binding.scopeType === "PROJECT") {
        const project = await this.options.projects.tryGetById(binding.scopeId);
        if (project) {
          projectName.set(project.id, project.name);
          activeProjectIds.add(project.id);
        }
      }
    }

    return {
      orgName,
      teamName,
      activeProjectIds,
      projectName,
      customRoleName,
      customRoles,
    };
  }
  async enrichApiKeyList({
    apiKeys,
  }: {
    apiKeys: ApiKey[];
  }): Promise<ApiKeyListEnrichment> {
    const organizationId = apiKeys[0]?.organizationId;
    const customRoles = organizationId
      ? await this.customRoles(
          [
            ...new Set(
              apiKeys.flatMap((key) =>
                key.roleBindings.flatMap((binding) =>
                  binding.customRoleId ? [binding.customRoleId] : [],
                ),
              ),
            ),
          ],
          organizationId,
        )
      : [];
    if (!organizationId) return { customRoles, users: [] };

    const userIds = new Set(
      apiKeys.flatMap((key) =>
        [key.userId, key.createdByUserId].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    );
    const users = (await this.options.authz.listOrganizationBindings({
      organizationId,
    }))
      .flatMap((binding) =>
        binding.user && userIds.has(binding.user.id)
          ? [
              {
                id: binding.user.id,
                name: binding.user.name,
                email: binding.user.email,
              },
            ]
          : [],
      );
    return { customRoles, users: [...new Map(users.map((user) => [user.id, user])).values()] };
  }

  private validatePermissionSelection(input: {
    bindings: ApiKeyScope[];
    permissionMode: string;
    permissions?: string[];
  }): string[] | undefined {
    const hasCustomBinding = input.bindings.some(
      (binding) => binding.role === "CUSTOM",
    );
    const hasPermissions = Boolean(input.permissions?.length);
    const isRestricted = input.permissionMode === "restricted";

    if (isRestricted || hasCustomBinding || hasPermissions) {
      if (!isRestricted) {
        throw new ApiKeyScopeViolationError(
          "CUSTOM permissions require permissionMode 'restricted'",
        );
      }
      if (!hasCustomBinding) {
        throw new ApiKeyScopeViolationError(
          "restricted mode requires at least one CUSTOM binding",
        );
      }
      if (!hasPermissions) {
        throw new ApiKeyScopeViolationError(
          "CUSTOM bindings require at least one permission",
        );
      }
    }

    for (const permission of input.permissions ?? []) {
      if (!apiKeyPermissionSchema.safeParse(permission).success) {
        throw new ApiKeyScopeViolationError(
          `Invalid permission format "${permission}" — must match resource:action`,
        );
      }
    }

    return input.permissions?.length ? [...input.permissions].sort() : undefined;
  }

  private trySplitToken(token: string): { lookupId: string; secret: string } | null { return this.options.tokens.trySplit(token); }
  private async tryResolveLegacyProjectKey(
    token: string,
  ): Promise<ResolvedApiKeyToken | null> {
    const projectId = await this.repository.tryFindLegacyProjectId({ token });
    if (!projectId) return null;
    const project = await this.options.projects.tryGetWithTeam(projectId);
    return project
      ? resolvedApiKeyTokenSchema.parse({ type: "legacyProjectKey", project })
      : null;
  }
  private async tryResolveCurrentApiKey(
    token: string,
    projectId: string | null,
  ): Promise<ResolvedApiKeyToken | null> {
    const apiKey = await this.tryVerify({ token });
    if (!apiKey) return null;

    let effectiveProjectId = projectId;
    if (!effectiveProjectId) {
      const projectIds = [
        ...new Set(
          apiKey.roleBindings.flatMap((binding) =>
            binding.scopeType === "PROJECT" && binding.scopeId
              ? [binding.scopeId]
              : [],
          ),
        ),
      ];
      if (projectIds.length === 1) effectiveProjectId = projectIds[0] ?? null;
    }
    if (!effectiveProjectId) return null;

    const project = await this.options.projects.tryGetWithTeam(
      effectiveProjectId,
    );
    if (!project || project.team.organizationId !== apiKey.organizationId) {
      return null;
    }

    return resolvedApiKeyTokenSchema.parse({
      type: "apiKey",
      apiKeyId: apiKey.id,
      userId: apiKey.userId,
      organizationId: apiKey.organizationId,
      ingestSourceType: apiKey.ingestSourceType,
      ingestionTemplateId: apiKey.ingestionTemplateId,
      isLangySessionKey: apiKey.name === LANGY_SESSION_API_KEY_NAME,
      project,
    });
  }
  private async getInOrganization(id: string, organizationId: string): Promise<StoredApiKey> { const row = await this.repository.tryFindByIdInOrganization({ id, organizationId }); if (!row) throw new ApiKeyNotFoundError(id); return row; }
  private async assertPersonalScopesOwnedBy(input: { scopes: ApiKeyScope[]; organizationId: string; ownerUserId: string | null }): Promise<void> {
    for (const scope of input.scopes) {
      if (scope.scopeType === "ORGANIZATION") continue;
      const personal = await this.repository.tryFindPersonalWorkspaceOwner({ organizationId: input.organizationId, scopeId: scope.scopeId });
      if (personal && personal.ownerUserId !== input.ownerUserId) throw new ApiKeyScopeViolationError("Personal workspace scopes may only be granted to their owner");
    }
  }

  private async validateScope(binding: ApiKeyScope, organizationId: string): Promise<ResolvedScope> {
    if (binding.scopeType === "ORGANIZATION") {
      if (binding.scopeId !== organizationId) throw new ApiKeyScopeViolationError("Organization scope must match the API key's organization");
      return { type: "organization", id: organizationId, organizationId };
    }
    if (binding.scopeType === "TEAM") {
      try {
        await this.options.organizations.getTeam({ organizationId, teamId: binding.scopeId });
      } catch {
        throw new ApiKeyScopeViolationError(`Team ${binding.scopeId} not found in this organization`);
      }
      return { type: "team", id: binding.scopeId, organizationId };
    }
    const project = await this.options.projects.getWithTeam(binding.scopeId);
    if (!project || project.archivedAt || project.team.organizationId !== organizationId) throw new ApiKeyScopeViolationError(`Project ${binding.scopeId} not found or archived`);
    return { type: "project", id: binding.scopeId, teamId: project.team.id, organizationId };
  }

  private async assertCeiling(userId: string, organizationId: string, bindings: ApiKeyScope[], permissions: string[]): Promise<void> {
    for (const binding of bindings) {
      const scope = await this.validateScope(binding, organizationId);
      const checks = await this.permissionsForBinding(binding, organizationId, permissions);
      for (const permission of checks) {
        const authzScope = scope.type === "organization"
          ? { type: "organization" as const, id: scope.id }
          : scope.type === "team"
            ? { type: "team" as const, id: scope.id, organizationId }
            : { type: "project" as const, id: scope.id, teamId: scope.teamId as string, organizationId };
        const allowed = await this.options.authz.can({ principal: { type: "user", id: userId }, permission: permission as AuthzPermission, scope: authzScope });
        if (!allowed) throw new ApiKeyScopeViolationError(`Cannot grant permission ${permission} beyond the owner's ceiling`);
      }
    }
  }

  private async permissionsForBinding(binding: ApiKeyScope, organizationId: string, rawPermissions: string[]): Promise<string[]> {
    if (binding.role !== "CUSTOM") {
      return [binding.role === "ADMIN"
        ? binding.scopeType === "ORGANIZATION" ? "organization:manage" : "project:manage"
        : binding.role === "MEMBER"
          ? binding.scopeType === "ORGANIZATION" ? "organization:view" : "project:update"
          : "project:view"];
    }
    if (rawPermissions.length > 0) return [...rawPermissions].sort();
    if (!binding.customRoleId) throw new ApiKeyScopeViolationError("CUSTOM role requires a customRoleId");
    const role = (await this.options.authz.listUserCreatedRoles({ organizationId })).find((candidate) => candidate.id === binding.customRoleId);
    if (!role || !Array.isArray(role.permissions) || !role.permissions.every((permission): permission is string => typeof permission === "string")) throw new ApiKeyScopeViolationError(`Custom role ${binding.customRoleId} not found or has malformed permissions`);
    return [...role.permissions].sort();
  }
  private async writeBindings(input: { apiKeyId: string; organizationId: string; bindings?: ApiKeyScope[]; permissions?: string[]; actor: { type: "user" | "system"; id: string | null }; replace?: boolean; roleId?: string }): Promise<ApiKeyScope[] | undefined> {
    if (!input.bindings) return undefined;

    let bindings = input.bindings;
    if (input.permissions?.length) {
      const roleId = input.roleId ?? `apikey:${input.apiKeyId}`;
      await this.options.grants.defineRole({
        organizationId: input.organizationId,
        roleId,
        name: `apikey:${input.apiKeyId}`,
        permissions: [...input.permissions].sort(),
        kind: "system_api_key",
        actor: input.actor,
      });
      bindings = bindings.map((binding) =>
        binding.role === "CUSTOM"
          ? { ...binding, customRoleId: roleId }
          : binding,
      );
    }

    const attached = await this.options.grants.attachBindings({
      organizationId: input.organizationId,
      bindings: bindings.map((binding) => ({
        bindingId: this.options.newBindingId(),
        principal: { apiKeyId: input.apiKeyId },
        role: binding.role,
        customRoleId:
          binding.role === "CUSTOM" ? (binding.customRoleId ?? null) : null,
        scopeType: binding.scopeType,
        scopeId: binding.scopeId,
      })),
      actor: input.actor,
      source: "grants-service",
      onDuplicate: "skip",
    });
    if (input.replace) {
      await this.options.grants.revokeBindingsWhere({
        organizationId: input.organizationId,
        where: {
          apiKeyId: input.apiKeyId,
          ...(attached.attached.length
            ? { id: { notIn: [...attached.attached, ...attached.duplicates] } }
            : {}),
        },
        actor: input.actor,
        reason: "api key grants replaced",
      });
    }
    return bindings;
  }
  private async customRoles(ids: string[], organizationId: string): Promise<ApiKeyRoleSummary[]> {
    if (ids.length === 0) return [];
    return (await this.options.authz.listUserCreatedRoles({ organizationId }))
      .filter((role) => ids.includes(role.id))
      .map((role) => ({
        id: role.id,
        name: role.name,
        permissions:
          Array.isArray(role.permissions) &&
          role.permissions.every(
            (permission): permission is string => typeof permission === "string",
          )
            ? role.permissions
            : [],
      }));
  }

  private async customPermissions(
    row: StoredApiKey,
    organizationId: string,
  ): Promise<string[]> {
    const ids = new Set(
      row.roleBindings.flatMap((binding) =>
        binding.customRoleId ? [binding.customRoleId] : [],
      ),
    );
    if (ids.size === 0) return [];
    const roles = await this.options.authz.listUserCreatedRoles({
      organizationId,
    });
    return [
      ...new Set(
        roles
          .filter((role) => ids.has(role.id) && Array.isArray(role.permissions))
          .flatMap((role) =>
            Array.isArray(role.permissions)
              ? role.permissions.filter(
                  (permission): permission is string =>
                    typeof permission === "string",
                )
              : [],
          ),
      ),
    ].sort();
  }
}
