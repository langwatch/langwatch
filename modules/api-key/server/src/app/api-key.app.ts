/**
 * The API-key feature's application: what its doors call. It holds the service the feature's
 * api files reach, and it is the one typed thing a transport is given.
 */
import {
  ApiKeyAdminRequiredError,
  type ApiKey,
  type ApiKeyBinding,
  type ApiKeyListEntry,
  type ApiKeyName,
  type ApiKeyProject,
  type ApiKeyTeam,
  type ApiKeyUser,
  type CreateApiKeyInput,
  type NamedApiKeyBinding,
  type UpdateApiKeyInput,
  ApiKeyApi,
  type ApiKeyBindingNames,
  type ApiKeyCredentialCheck,
  type ApiKeyDetail,
  type ApiKeyListEnrichment,
  type ApiKeyVerification,
  type ApiKeyVisibleProjects,
  type ApiKeyVisibleProjectsInput,
  type OrganizationApiKeyResolution,
  type OrganizationApiKeyResolutionInput,
  type ResolvedApiKeyCredential,
  type ApiKeyTokenResolutionInput,
  type CliKeySelection,
  type ApiKeySelectionInput,
  type RevokeApiKeyInput,
  type ApiKeyCallerReadInput,
} from "@langwatch/api-key-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { AuthzApi } from "@langwatch/authz-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";
import { ApiKeyTokenAdapter } from "../repositories/memory/memory.api-key-token.repository.ts";
import type { ApiKeyBindingId } from "./api-key.app.ts";
import type { ApiKeyDiagnostics } from "./api-key.app.ts";
import type { ApiKeyRepositories } from "../repositories/api-key.repositories.ts";
import { ApiKeyService } from "../services/api-key.service.ts";
import {
  LegacyApiKeyGrantService,
  type AuthzBindingIdDeriver,
} from "../services/legacy-api-key-grant.service.ts";

/** Who an operation is performed by, and whose membership is proved. */
export interface ApiKeyCaller {
  readonly id: string;
}

/** The technical collaborators the composing process supplies. */
export interface ApiKeyInfrastructure {
  /** The HMAC key a stored secret is derived under. */
  readonly pepper: string;
  readonly bindingIds: ApiKeyBindingId;
  readonly deriveBindingId: AuthzBindingIdDeriver;
  readonly diagnostics: ApiKeyDiagnostics;
}
type ApiKeyDependencies = Readonly<{
  authorization: typeof AuthzApi;
  organizations: typeof OrganizationApi;
  projects: typeof ProjectApi;
}>;
export type ApiKeySetup = FeatureSetup<
  ApiKeyDependencies,
  ApiKeyInfrastructure,
  undefined,
  ApiKeyRepositories
>;

/** What a key may create: the caller's own personal key, or an admin's key. */
export type CreateApiKeyRequest = Readonly<{
  organizationId: string;
  name: string;
  description?: string | undefined;
  expiresAt?: CreateApiKeyInput["expiresAt"];
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

export class ApiKeyApp implements ApiKeyApi {
  static readonly contract = ApiKeyApi;
  static readonly dependencies: ApiKeyDependencies = {
    authorization: AuthzApi,
    organizations: OrganizationApi,
    projects: ProjectApi,
  };

  static create(setup: ApiKeySetup): ApiKeyApp {
    const authorization = setup.dependencies.authorization;

    return new ApiKeyApp(
      ApiKeyService.create({
        repository: setup.repositories.apiKeys,
        authz: authorization,
        grants: authorization,
        organizations: setup.dependencies.organizations,
        projects: setup.dependencies.projects,
        bindingIds: setup.infrastructure.bindingIds,
        legacyGrants: LegacyApiKeyGrantService.create({
          authz: authorization,
          grants: authorization,
          deriveBindingId: setup.infrastructure.deriveBindingId,
          diagnostics: setup.infrastructure.diagnostics,
        }),
        tokens: ApiKeyTokenAdapter.create(setup.infrastructure.pepper),
      }),
      authorization,
    );
  }

  private constructor(service: ApiKeyService, authorization: AuthzApi) {
    this.#service = service;
    this.#authorization = authorization;
  }

  readonly #service: ApiKeyService;
  readonly #authorization: AuthzApi;

  /**
   * The service itself, for the one thing this application deliberately is not about: turning a
   * credential on the wire into a caller. Everything below is the MANAGEMENT surface — a
   * signed-in member listing, minting and retiring keys in an organization they belong to.
   */
  async create(input: CreateApiKeyInput) {
    return this.#service.create(input);
  }
  async update(input: UpdateApiKeyInput) {
    return this.#service.update(input);
  }
  async findVerifiedToken(input: { token: string }): Promise<ApiKeyVerification | null> {
    return this.#service.findVerifiedToken(input);
  }
  async findResolvedToken(
    input: ApiKeyTokenResolutionInput,
  ): Promise<ResolvedApiKeyCredential | null> {
    return this.#service.findResolvedToken(input);
  }
  async regenerateLegacyProjectKey(input: { projectId: string }): Promise<string> {
    return this.#service.regenerateLegacyProjectKey(input);
  }
  async resolveOrganizationToken(
    input: OrganizationApiKeyResolutionInput,
  ): Promise<OrganizationApiKeyResolution> {
    return this.#service.resolveOrganizationToken(input);
  }
  async resolveVisibleProjects(input: ApiKeyVisibleProjectsInput): Promise<ApiKeyVisibleProjects> {
    return this.#service.resolveVisibleProjects(input);
  }
  markUsed(input: { id: string }): void {
    this.#service.markUsed(input);
  }
  async list(input: { userId: string; organizationId: string }) {
    return this.#service.list(input);
  }
  async listAll(input: { organizationId: string }) {
    return this.#service.listAll(input);
  }
  async revoke(input: RevokeApiKeyInput) {
    return this.#service.revoke(input);
  }
  async ensureCallerIsOrgMember(input: { userId: string; organizationId: string }): Promise<void> {
    return this.#service.ensureCallerIsOrgMember(input);
  }
  async assertSelectionWithinCeiling(input: ApiKeySelectionInput): Promise<void> {
    return this.#service.assertSelectionWithinCeiling(input);
  }
  async isOrgAdmin(input: { userId: string; organizationId: string }): Promise<boolean> {
    return this.#service.isOrgAdmin(input);
  }
  async isOrgAdminApiKey(input: { apiKeyId: string; organizationId: string }): Promise<boolean> {
    return this.#service.isOrgAdminApiKey(input);
  }
  /**
   * The question a management door asks about the credential in front of it,
   * rather than about a member: the key's own ceiling caps the answer, so a
   * narrowed key cannot borrow the reach of whoever created it.
   */
  async credentialCanManageOrganization(input: ApiKeyCredentialCheck): Promise<boolean> {
    return this.#authorization.hasApiKeyPermission({
      apiKeyId: input.apiKeyId,
      userId: input.userId,
      organizationId: input.organizationId,
      scope: { type: "org", id: input.organizationId },
      permission: "organization:manage",
    });
  }
  async findById(input: { id: string }) {
    return this.#service.findById(input);
  }
  async getByIdForCaller(input: ApiKeyCallerReadInput): Promise<ApiKeyDetail> {
    return this.#service.getByIdForCaller(input);
  }
  async findNameByIdInOrg(input: { id: string; organizationId: string }) {
    return this.#service.findNameByIdInOrg(input);
  }
  async getUserBindings(input: { userId: string; organizationId: string }) {
    return this.#service.getUserBindings(input);
  }
  async getOrgProjects(input: { organizationId: string }) {
    return this.#service.getOrgProjects(input);
  }
  async getOrgTeams(input: { organizationId: string }) {
    return this.#service.getOrgTeams(input);
  }
  async getOrgMembers(input: { organizationId: string }) {
    return this.#service.getOrgMembers(input);
  }
  async findIngestionKey(input: { organizationId: string; projectId: string; sourceType: string }) {
    return this.#service.findIngestionKey(input);
  }
  async listIngestionKeysForProject(input: { organizationId: string; projectId: string }) {
    return this.#service.listIngestionKeysForProject(input);
  }
  async findByLookupId(input: { lookupId: string }) {
    return this.#service.findByLookupId(input);
  }
  async validateCliSelection(input: {
    userId: string;
    organizationId: string;
    selection: CliKeySelection;
  }) {
    return this.#service.validateCliSelection(input);
  }
  async findDefaultCliSelection(input: { userId: string; organizationId: string }) {
    return this.#service.findDefaultCliSelection(input);
  }
  async mintCliLoginKey(input: {
    userId: string;
    organizationId: string;
    deviceLabel: string;
    selection: CliKeySelection;
  }) {
    return this.#service.mintCliLoginKey(input);
  }
  async revokeCliLoginKeysForDevice(input: {
    userId: string;
    organizationId: string;
    deviceLabel: string;
    exceptApiKeyId?: string;
    createdBefore?: Instant;
  }): Promise<void> {
    return this.#service.revokeCliLoginKeysForDevice(input);
  }
  async revokeCliLoginKeyForLogout(input: {
    apiKeyId: string;
    userId: string;
    organizationId: string;
  }): Promise<void> {
    return this.#service.revokeCliLoginKeyForLogout(input);
  }
  async enrichBindingsWithNames(input: {
    bindings: ApiKeyBinding[];
    organizationId?: string;
  }): Promise<ApiKeyBindingNames> {
    return this.#service.enrichBindingsWithNames(input);
  }
  async enrichApiKeyList(input: { apiKeys: ApiKey[] }): Promise<ApiKeyListEnrichment> {
    return this.#service.enrichApiKeyList(input);
  }

  /**
   * The caller's own bindings in one organization, each with its scope named. Bindings on
   * archived projects are dropped: the drawers mirror this list to cap what a new key may be
   * given, and a scope that no longer exists is not something a key should be able to name.
   */
  async listCallerBindings(
    input: Readonly<{ organizationId: string }>,
    by: ApiKeyCaller,
  ): Promise<NamedApiKeyBinding[]> {
    await this.#ensureMember(input.organizationId, by);
    const bindings = await this.#service.getUserBindings({
      userId: by.id,
      organizationId: input.organizationId,
    });

    const { orgName, teamName, activeProjectIds, projectName, customRoleName } =
      await this.#service.enrichBindingsWithNames({ bindings });

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
   * One key id resolved to a display name, for a caller who already has the id. Answers null
   * identically for an id that does not exist and one that belongs to another organization, so
   * it cannot be used to enumerate.
   */
  async findKeyName(
    input: Readonly<{ organizationId: string; apiKeyId: string }>,
    by: ApiKeyCaller,
  ): Promise<ApiKeyName | null> {
    await this.#ensureMember(input.organizationId, by);
    return this.#service.findNameByIdInOrg({
      id: input.apiKeyId,
      organizationId: input.organizationId,
    });
  }

  /**
   * The organization's keys for an admin, the caller's own for everyone else. Never the secret:
   * a key is identified by the first five characters of its lookup id, which is enough to
   * recognise one and not enough to use it.
   */
  async listKeys(
    input: Readonly<{ organizationId: string }>,
    by: ApiKeyCaller,
  ): Promise<ApiKeyListEntry[]> {
    await this.#ensureMember(input.organizationId, by);
    const callerIsAdmin = await this.#isOrganizationAdmin(input.organizationId, by);

    const apiKeys = callerIsAdmin
      ? await this.#service.listAll({ organizationId: input.organizationId })
      : await this.#service.list({
          userId: by.id,
          organizationId: input.organizationId,
        });

    const allBindings = apiKeys.flatMap((k) => k.roleBindings);
    // A key row renders the scope's NAME — "Acme" and "Checkout", not two
    // opaque ids — so the scope half of the enrichment is read alongside the
    // custom-role half. Both come from the one call.
    const { orgName, teamName, projectName, customRoleName, customRoles } =
      await this.#service.enrichBindingsWithNames({
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

    const { users } = await this.#service.enrichApiKeyList({ apiKeys });
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
        scopeName:
          rb.scopeType === "ORGANIZATION"
            ? (orgName.get(rb.scopeId) ?? null)
            : rb.scopeType === "TEAM"
              ? (teamName.get(rb.scopeId) ?? null)
              : (projectName.get(rb.scopeId) ?? null),
      })),
    }));
  }

  /**
   * Mints a key and hands back its plaintext token — once, here, and nowhere else. Nothing
   * stores it and no read returns it, so a caller who loses it revokes and mints again.
   */
  async createKey(
    input: CreateApiKeyRequest,
    by: ApiKeyCaller,
  ): Promise<{ token: string; apiKey: ApiKey; assignedToUserId: string | null }> {
    await this.#ensureMember(input.organizationId, by);
    const isService = input.keyType === "service";
    const assignedToAnother = Boolean(input.assignedToUserId) && input.assignedToUserId !== by.id;
    const privilegedMint = isService || assignedToAnother;

    if (privilegedMint && !(await this.#isOrganizationAdmin(input.organizationId, by))) {
      throw new ApiKeyAdminRequiredError(
        isService ? "create-service-key" : "assign-to-another-user",
      );
    }

    const assignedToUserId = isService ? null : (input.assignedToUserId ?? by.id);
    const { token, apiKey } = await this.#service.create({
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
    await this.#ensureMember(input.organizationId, by);
    const callerIsAdmin = await this.#isOrganizationAdmin(input.organizationId, by);

    return this.#service.update({
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
    await this.#ensureMember(input.organizationId, by);
    const callerIsAdmin = await this.#isOrganizationAdmin(input.organizationId, by);

    await this.#service.revoke({
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
    await this.#ensureMember(input.organizationId, by);
    return this.#service.getOrgProjects({ organizationId: input.organizationId });
  }

  /** The organization's teams, for the scope picker. */
  async listOrganizationTeams(
    input: Readonly<{ organizationId: string }>,
    by: ApiKeyCaller,
  ): Promise<ApiKeyTeam[]> {
    await this.#ensureMember(input.organizationId, by);
    return this.#service.getOrgTeams({ organizationId: input.organizationId });
  }

  /**
   * The organization's members, for assigning a key to one of them. Empty for a non-admin
   * rather than refused: only an admin can assign a key to somebody else, so a non-admin has
   * nobody to pick from and the picker is simply not offered.
   */
  async listOrganizationMembers(
    input: Readonly<{ organizationId: string }>,
    by: ApiKeyCaller,
  ): Promise<ApiKeyUser[]> {
    await this.#ensureMember(input.organizationId, by);
    if (!(await this.#isOrganizationAdmin(input.organizationId, by))) return [];
    return this.#service.getOrgMembers({ organizationId: input.organizationId });
  }

  #ensureMember(organizationId: string, by: ApiKeyCaller): Promise<void> {
    return this.#service.ensureCallerIsOrgMember({
      userId: by.id,
      organizationId,
    });
  }

  #isOrganizationAdmin(organizationId: string, by: ApiKeyCaller): Promise<boolean> {
    return this.#service.isOrgAdmin({ userId: by.id, organizationId });
  }
}

/** Generates opaque AuthZ binding identifiers for API-key grants. */
export interface ApiKeyBindingId {
  generateBindingId(): string;
}


export interface ApiKeyDiagnostics {
  warn(context: Record<string, unknown>, message: string): void;
}
