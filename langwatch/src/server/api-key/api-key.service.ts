import type { PrismaClient, ApiKey } from "@prisma/client";
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { ApiKeyRepository, type ApiKeyWithBindings } from "./api-key.repository";
import { RoleRepository, CUSTOM_ROLE_KIND } from "~/server/role/repositories/role.repository";
import {
  generateApiKeyToken,
  hashSecret,
  INGEST_KEY_PREFIX,
  splitApiKeyToken,
  verifySecret,
} from "./api-key-token.utils";
import {
  ApiKeyAlreadyRevokedError,
  ApiKeyNotFoundError,
  ApiKeyNotOwnedError,
  ApiKeyScopeViolationError,
} from "./errors";
import type { Permission } from "~/server/api/rbac";
import { checkRoleBindingPermission } from "~/server/rbac/role-binding-resolver";
import { parseCustomRolePermissions, permissionFormatSchema } from "~/server/rbac/custom-role-permissions";
import { DomainError } from "~/server/app-layer/domain-error";
import { createLogger } from "~/utils/logger/server";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";

const logger = createLogger("langwatch:api-key:service");

type RoleBindingBase = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

type RoleBindingInput =
  | (RoleBindingBase & { role: "ADMIN" | "MEMBER" | "VIEWER" })
  | (RoleBindingBase & { role: "CUSTOM"; customRoleId?: string });

type ResolvedRoleBinding =
  | (RoleBindingBase & { role: "ADMIN" | "MEMBER" | "VIEWER" })
  | (RoleBindingBase & { role: "CUSTOM"; customRoleId: string });

type CreatorScope =
  | { type: "org"; id: string }
  | { type: "team"; id: string }
  | { type: "project"; id: string; teamId: string };

export class ApiKeyService {
  private readonly repo: ApiKeyRepository;
  private readonly roleRepo: RoleRepository;
  private readonly prisma: PrismaClient;

  constructor({
    prisma,
    repo,
    roleRepo,
  }: {
    prisma: PrismaClient;
    repo: ApiKeyRepository;
    roleRepo: RoleRepository;
  }) {
    this.prisma = prisma;
    this.repo = repo;
    this.roleRepo = roleRepo;
  }

  static create(prisma: PrismaClient): ApiKeyService {
    return new ApiKeyService({
      prisma,
      repo: ApiKeyRepository.create(prisma),
      roleRepo: new RoleRepository(prisma),
    });
  }

  /**
   * Creates a new API key with the given role bindings inside a transaction.
   * Returns the plaintext token (shown once) plus the persisted record.
   *
   * Enforces two invariants before persisting:
   *   1. The target user is a member of the target organization.
   *   2. Every requested binding is within the target user's own ceiling — a
   *      key cannot grant permissions the user does not themselves hold at the
   *      requested scope. Violations throw `ApiKeyScopeViolationError`.
   *
   * When `assignedToUserId` is provided, the key is owned by that user
   * (their permissions act as the ceiling). The caller must be an org admin.
   */
  async create({
    name,
    description,
    userId,
    createdByUserId,
    organizationId,
    expiresAt,
    permissionMode,
    permissions,
    bindings,
    ingestSourceType,
    ingestionTemplateId,
  }: {
    name: string;
    description?: string | null;
    userId?: string | null;
    createdByUserId?: string | null;
    organizationId: string;
    expiresAt?: Date | null;
    permissionMode: string;
    permissions?: string[];
    bindings: RoleBindingInput[];
    ingestSourceType?: string | null;
    ingestionTemplateId?: string | null;
  }): Promise<{ token: string; apiKey: ApiKey }> {
    const hasCustomBinding = bindings.some((b) => b.role === TeamUserRole.CUSTOM);
    const hasPermissions = !!permissions && permissions.length > 0;
    const isRestricted = permissionMode === "restricted";

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

    if (hasPermissions) {
      ApiKeyService.assertPermissionFormat(permissions);
    }

    const sortedPermissions = hasPermissions
      ? [...permissions].sort()
      : undefined;

    if (userId) {
      await this.ensureCallerIsOrgMember({ userId, organizationId });
    } else if (bindings.length > 0) {
      for (const binding of bindings) {
        await this.resolveAndValidateScope({ binding, organizationId });
      }
    }

    // Intentional: service keys (userId=null) with no explicit bindings
    // default to org-wide ADMIN. This is the expected behavior for
    // headless automation keys that need full org access.
    let effectiveBindings = bindings;
    if (!userId && effectiveBindings.length === 0) {
      effectiveBindings = [{
        role: "ADMIN",
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
      }];
    }

    // Ingestion-only keys (identified by ingestSourceType) carry the ik-lw-
    // prefix so they're distinguishable from full-access sk-lw- keys; same
    // scheme otherwise, so resolution is unaffected.
    const { token, lookupId, hashedSecret } = generateApiKeyToken(
      ingestSourceType ? { prefix: INGEST_KEY_PREFIX } : undefined,
    );

    const apiKey = await this.prisma.$transaction(async (tx) => {
      const txRepo = ApiKeyRepository.create(tx);
      const txRoleRepo = new RoleRepository(tx);

      if (userId) {
        await this.assertBindingsWithinCeiling({
          prisma: tx as unknown as PrismaClient,
          ceilingUserId: userId,
          organizationId,
          bindings,
          rawPermissions: sortedPermissions,
        });
      }

      const created = await txRepo.create({
        name,
        description,
        lookupId,
        hashedSecret,
        permissionMode,
        userId,
        createdByUserId,
        organizationId,
        expiresAt,
        ingestSourceType,
        ingestionTemplateId,
      });

      if (sortedPermissions) {
        const customRole = await txRoleRepo.create({
          name: `apikey:${created.id}`,
          organizationId,
          permissions: sortedPermissions,
          kind: CUSTOM_ROLE_KIND.SYSTEM_API_KEY,
        });
        effectiveBindings = effectiveBindings.map((b) =>
          b.role === TeamUserRole.CUSTOM
            ? { ...b, customRoleId: customRole.id }
            : b,
        );
      }

      if (effectiveBindings.length > 0) {
        await txRepo.createRoleBindings({
          apiKeyId: created.id,
          organizationId,
          bindings: effectiveBindings,
        });
      }

      return created;
    });

    return { token, apiKey };
  }

  /**
   * Updates an API key's metadata and/or role bindings.
   * The token itself is NOT changed — only name, description, permissionMode,
   * and bindings can be updated.
   *
   * For non-admins: only the key owner can update.
   * For admins: can update any key in the organization.
   *
   * Binding changes are validated against the key owner's ceiling.
   */
  async update({
    id,
    callerUserId,
    callerIsAdmin,
    organizationId,
    name,
    description,
    permissionMode,
    permissions,
    bindings,
  }: {
    id: string;
    callerUserId: string;
    callerIsAdmin: boolean;
    organizationId: string;
    name?: string;
    description?: string | null;
    permissionMode?: string;
    permissions?: string[];
    bindings?: RoleBindingInput[];
  }): Promise<ApiKeyWithBindings> {
    const existing = await this.repo.findById({ id });
    if (!existing) throw new ApiKeyNotFoundError(id);
    if (existing.organizationId !== organizationId) {
      throw new ApiKeyNotFoundError(id);
    }

    if (!callerIsAdmin) {
      if (!existing.userId || existing.userId !== callerUserId) {
        throw new ApiKeyNotOwnedError(id);
      }
    }

    if (existing.revokedAt) throw new ApiKeyAlreadyRevokedError(id);

    const updateHasCustomBinding = bindings?.some((b) => b.role === TeamUserRole.CUSTOM) ?? false;
    const updateHasPermissions = !!permissions && permissions.length > 0;
    const updateIsRestricted = permissionMode === "restricted";

    if (updateIsRestricted || updateHasCustomBinding || updateHasPermissions) {
      if (!updateIsRestricted) {
        throw new ApiKeyScopeViolationError(
          "CUSTOM permissions require permissionMode 'restricted'",
        );
      }
      if (!updateHasCustomBinding) {
        throw new ApiKeyScopeViolationError(
          "restricted mode requires bindings with at least one CUSTOM role",
        );
      }
      if (!updateHasPermissions) {
        throw new ApiKeyScopeViolationError(
          "CUSTOM bindings require at least one permission",
        );
      }
    }

    if (updateHasPermissions) {
      ApiKeyService.assertPermissionFormat(permissions);
    }

    const sortedPermissions = updateHasPermissions
      ? [...permissions].sort()
      : undefined;

    if (bindings && !existing.userId) {
      for (const binding of bindings) {
        await this.resolveAndValidateScope({ binding, organizationId });
      }
    }

    const oldCustomRoleIds = [
      ...new Set(
        existing.roleBindings
          .map((rb) => rb.customRoleId)
          .filter((cid): cid is string => cid !== null),
      ),
    ];

    return this.prisma.$transaction(async (tx) => {
      const txRepo = ApiKeyRepository.create(tx);
      const txRoleRepo = new RoleRepository(tx);

      if (bindings && existing.userId) {
        await this.assertBindingsWithinCeiling({
          prisma: tx as unknown as PrismaClient,
          ceilingUserId: existing.userId,
          organizationId,
          bindings,
          rawPermissions: sortedPermissions,
        });
      }

      let effectiveBindings = bindings;

      if (sortedPermissions && effectiveBindings) {
        const existingCustomRoleId = existing.roleBindings.find(
          (rb) => rb.customRoleId !== null,
        )?.customRoleId;

        const canReuse = existingCustomRoleId
          ? await txRoleRepo.isExclusiveToApiKey({
              roleId: existingCustomRoleId,
              apiKeyId: id,
            })
          : false;

        let customRole;
        if (canReuse && existingCustomRoleId) {
          customRole = await txRoleRepo.update(existingCustomRoleId, {
            permissions: sortedPermissions,
          });
        } else {
          customRole = await txRoleRepo.create({
            name: `apikey:${id}:${generate(KSUID_RESOURCES.API_KEY_ROLE).toString()}`,
            organizationId,
            permissions: sortedPermissions,
            kind: CUSTOM_ROLE_KIND.SYSTEM_API_KEY,
          });
        }
        effectiveBindings = effectiveBindings.map((b) =>
          b.role === TeamUserRole.CUSTOM
            ? { ...b, customRoleId: customRole.id }
            : b,
        );
      }

      await txRepo.update({
        id,
        name,
        description,
        permissionMode,
      });

      if (effectiveBindings) {
        await txRepo.replaceRoleBindings({
          apiKeyId: id,
          organizationId,
          bindings: effectiveBindings,
        });

        const newCustomRoleIds = new Set(
          effectiveBindings
            .filter((b): b is Extract<RoleBindingInput, { role: "CUSTOM" }> => b.role === "CUSTOM")
            .map((b) => b.customRoleId)
            .filter((cid): cid is string => !!cid),
        );
        const orphanedRoleIds = oldCustomRoleIds.filter(
          (roleId) => !newCustomRoleIds.has(roleId),
        );
        if (orphanedRoleIds.length > 0) {
          await txRoleRepo.deleteExclusiveToApiKey({
            roleIds: orphanedRoleIds,
            apiKeyId: id,
          });
        }
      }

      const updated = await txRepo.findById({ id });
      if (!updated) throw new ApiKeyNotFoundError(id);
      return updated;
    });
  }

  /**
   * Verifies the creator is a member of the org before an API key can be minted.
   */
  async ensureCallerIsOrgMember({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    const orgUser = await this.repo.findOrgMembership({ userId, organizationId });
    if (!orgUser) {
      throw new ApiKeyScopeViolationError("Not a member of this organization", {
        meta: { userId, organizationId },
      });
    }
  }

  /**
   * Validates every requested binding against the ceiling user's permissions.
   * Must be called inside a transaction to prevent TOCTOU races where
   * the user's bindings change between validation and write.
   */
  private async assertBindingsWithinCeiling({
    prisma,
    ceilingUserId,
    organizationId,
    bindings,
    rawPermissions,
  }: {
    prisma: PrismaClient;
    ceilingUserId: string;
    organizationId: string;
    bindings: RoleBindingInput[];
    rawPermissions?: string[];
  }): Promise<void> {
    for (const binding of bindings) {
      const scope = await this.resolveAndValidateScope({
        binding,
        organizationId,
      });

      if (binding.role === TeamUserRole.CUSTOM) {
        if (rawPermissions) {
          await this.assertRawPermissionsWithinCeiling({
            prisma,
            ceilingUserId,
            organizationId,
            scope,
            permissions: rawPermissions,
          });
        } else if (binding.customRoleId) {
          await this.assertCustomRoleWithinCeiling({
            prisma,
            ceilingUserId,
            organizationId,
            scope,
            customRoleId: binding.customRoleId,
          });
        } else {
          throw new ApiKeyScopeViolationError("CUSTOM role requires a customRoleId");
        }
      } else {
        await this.assertBuiltinRoleWithinCeiling({
          prisma,
          ceilingUserId,
          organizationId,
          scope,
          role: binding.role,
        });
      }
    }
  }

  private async resolveAndValidateScope({
    binding,
    organizationId,
  }: {
    binding: RoleBindingInput;
    organizationId: string;
  }): Promise<CreatorScope> {
    if (binding.scopeType === RoleBindingScopeType.ORGANIZATION) {
      if (binding.scopeId !== organizationId) {
        throw new ApiKeyScopeViolationError(
          "Organization scope must match the API key's organization",
          { meta: { scopeId: binding.scopeId, organizationId } },
        );
      }
      return { type: "org", id: binding.scopeId };
    }

    if (binding.scopeType === RoleBindingScopeType.TEAM) {
      const team = await this.repo.findTeamInOrg({
        teamId: binding.scopeId,
        organizationId,
      });
      if (!team) {
        throw new ApiKeyScopeViolationError(
          `Team ${binding.scopeId} not found in this organization`,
          { meta: { teamId: binding.scopeId, organizationId } },
        );
      }
      return { type: "team", id: binding.scopeId };
    }

    const project = await this.repo.findProjectWithTeam({
      projectId: binding.scopeId,
    });
    if (!project) {
      throw new ApiKeyScopeViolationError(
        `Project ${binding.scopeId} not found or archived`,
        { meta: { projectId: binding.scopeId } },
      );
    }
    if (project.team.organizationId !== organizationId) {
      throw new ApiKeyScopeViolationError(
        `Project ${binding.scopeId} does not belong to this organization`,
        { meta: { projectId: binding.scopeId, organizationId } },
      );
    }
    return { type: "project", id: binding.scopeId, teamId: project.team.id };
  }

  private async assertCustomRoleWithinCeiling({
    prisma,
    ceilingUserId,
    organizationId,
    scope,
    customRoleId,
  }: {
    prisma: PrismaClient;
    ceilingUserId: string;
    organizationId: string;
    scope: CreatorScope;
    customRoleId: string;
  }): Promise<void> {
    const customRole = await this.roleRepo.findByIdInOrg(customRoleId, organizationId);
    if (!customRole) {
      throw new ApiKeyScopeViolationError(
        `Custom role ${customRoleId} not found`,
        { meta: { customRoleId, organizationId } },
      );
    }
    let perms: string[];
    try {
      perms = parseCustomRolePermissions({
        customRoleId,
        permissions: customRole.permissions,
      });
    } catch (err) {
      if (DomainError.isHandled(err) && err.kind === "malformed_custom_role_permissions") {
        throw new ApiKeyScopeViolationError(
          `Custom role ${customRoleId} has malformed permissions`,
          {
            meta: { customRoleId, organizationId },
            reasons: [err],
          },
        );
      }
      throw err;
    }
    for (const perm of perms) {
      const userHas = await checkRoleBindingPermission({
        prisma,
        principal: { type: "user", id: ceilingUserId },
        organizationId,
        scope,
        permission: perm as Permission,
      });
      if (!userHas) {
        throw new ApiKeyScopeViolationError(
          `Cannot grant permission "${perm}" — exceeds your own access`,
          { meta: { permission: perm, scope } },
        );
      }
    }
  }

  private async assertRawPermissionsWithinCeiling({
    prisma,
    ceilingUserId,
    organizationId,
    scope,
    permissions,
  }: {
    prisma: PrismaClient;
    ceilingUserId: string;
    organizationId: string;
    scope: CreatorScope;
    permissions: string[];
  }): Promise<void> {
    for (const perm of permissions) {
      const userHas = await checkRoleBindingPermission({
        prisma,
        principal: { type: "user", id: ceilingUserId },
        organizationId,
        scope,
        permission: perm as Permission,
      });
      if (!userHas) {
        throw new ApiKeyScopeViolationError(
          `Cannot grant permission "${perm}" — exceeds your own access`,
          { meta: { permission: perm, scope } },
        );
      }
    }
  }

  private async assertBuiltinRoleWithinCeiling({
    prisma,
    ceilingUserId,
    organizationId,
    scope,
    role,
  }: {
    prisma: PrismaClient;
    ceilingUserId: string;
    organizationId: string;
    scope: CreatorScope;
    role: "ADMIN" | "MEMBER" | "VIEWER";
  }): Promise<void> {
    const isOrgScope = scope.type === "org";
    const representativePermission: Permission =
      role === TeamUserRole.ADMIN
        ? (isOrgScope ? "organization:manage" : "project:manage")
        : role === TeamUserRole.MEMBER
          ? (isOrgScope ? "organization:view" : "project:update")
          : "project:view";

    const userHasPermission = await checkRoleBindingPermission({
      prisma,
      principal: { type: "user", id: ceilingUserId },
      organizationId,
      scope,
      permission: representativePermission,
    });

    if (!userHasPermission) {
      throw new ApiKeyScopeViolationError(
        `Cannot create API key with ${role} permissions — exceeds your own access at ${scope.type}:${scope.id}`,
        { meta: { role, scope } },
      );
    }
  }

  private static assertPermissionFormat(permissions: string[]): void {
    for (const perm of permissions) {
      if (!permissionFormatSchema.safeParse(perm).success) {
        throw new ApiKeyScopeViolationError(
          `Invalid permission format "${perm}" — must match resource:action (lowercase)`,
          { meta: { permission: perm } },
        );
      }
    }
  }

  /**
   * Verifies an API key token string and returns the key record if valid.
   * Returns null if the token is invalid, revoked, or not found.
   *
   * Does NOT update lastUsedAt — callers should call markUsed() after
   * confirming the request is fully authorized (e.g., project resolved).
   */
  async verify({
    token,
  }: {
    token: string;
  }): Promise<ApiKeyWithBindings | null> {
    const parts = splitApiKeyToken(token);
    if (!parts) return null;

    const apiKey = await this.repo.findByLookupId({ lookupId: parts.lookupId });
    if (!apiKey) return null;

    // Revoked tokens are rejected
    if (apiKey.revokedAt) return null;

    // Expired tokens are rejected
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

    // Verify the secret portion — supports both current HMAC and legacy SHA-256
    const result = verifySecret(parts.secret, apiKey.hashedSecret);
    if (result === "no_match") return null;

    // Auto-upgrade legacy SHA-256 hashes to HMAC-SHA256 (fire-and-forget)
    if (result === "match_legacy") {
      const upgraded = hashSecret(parts.secret);
      this.repo.upgradeHash({ id: apiKey.id, hashedSecret: upgraded }).catch((err: unknown) => {
        logger.warn(
          { err, apiKeyId: apiKey.id },
          "failed to upgrade legacy hash to HMAC (fire-and-forget)",
        );
      });
    }

    return apiKey;
  }

  /**
   * Fire-and-forget lastUsedAt update. Call after full authorization succeeds.
   */
  markUsed({ id }: { id: string }): void {
    this.repo.updateLastUsedAt({ id }).catch((err: unknown) => {
      logger.warn(
        { err, apiKeyId: id },
        "failed to update API key lastUsedAt (fire-and-forget)",
      );
    });
  }

  /**
   * Lists all API keys for a user within an organization.
   */
  async list({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<ApiKeyWithBindings[]> {
    return this.repo.findAllByUser({ userId, organizationId });
  }

  /**
   * Lists ALL API keys in an organization (admin only).
   */
  async listAll({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ApiKeyWithBindings[]> {
    return this.repo.findAllByOrganization({ organizationId });
  }

  /**
   * Revokes an API key by setting revokedAt. Never hard-deletes.
   * Admins can revoke any key in the org. Non-admins can only revoke their own.
   */
  async revoke({
    id,
    callerUserId,
    callerIsAdmin,
    organizationId,
  }: {
    id: string;
    callerUserId: string;
    callerIsAdmin: boolean;
    organizationId: string;
  }): Promise<ApiKey> {
    const apiKey = await this.repo.findById({ id });
    if (!apiKey) throw new ApiKeyNotFoundError(id);
    if (apiKey.organizationId !== organizationId) {
      throw new ApiKeyNotFoundError(id);
    }
    if (!callerIsAdmin) {
      if (!apiKey.userId || apiKey.userId !== callerUserId) {
        throw new ApiKeyNotOwnedError(id);
      }
    }
    if (apiKey.revokedAt) throw new ApiKeyAlreadyRevokedError(id);

    return this.prisma.$transaction(async (tx) => {
      const txRepo = ApiKeyRepository.create(tx);
      const txRoleRepo = new RoleRepository(tx);

      const fresh = await txRepo.findById({ id });
      const customRoleIds = [
        ...new Set(
          (fresh?.roleBindings ?? [])
            .map((rb) => rb.customRoleId)
            .filter((cid): cid is string => cid !== null),
        ),
      ];

      const result = await txRepo.revoke({ id });

      if (customRoleIds.length > 0) {
        await txRoleRepo.deleteExclusiveToApiKey({
          roleIds: customRoleIds,
          apiKeyId: id,
        });
      }

      return result;
    });
  }

  /**
   * Checks whether a user has an ADMIN role binding at the organization scope.
   */
  async isOrgAdmin({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const binding = await this.repo.findOrgAdminBinding({ userId, organizationId });
    return !!binding;
  }

  /**
   * Gets a single API key by ID (for display, not verification).
   */
  async getById({ id }: { id: string }): Promise<ApiKeyWithBindings | null> {
    return this.repo.findById({ id });
  }

  async getUserBindings({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }) {
    return this.repo.findUserBindings({ userId, organizationId });
  }

  async getOrgProjects({ organizationId }: { organizationId: string }) {
    return this.repo.findProjectsInOrg({ organizationId });
  }

  async getOrgTeams({ organizationId }: { organizationId: string }) {
    return this.repo.findTeamsInOrg({ organizationId });
  }

  async getOrgMembers({ organizationId }: { organizationId: string }) {
    return this.repo.findOrgMembers({ organizationId });
  }

  async enrichBindingsWithNames({
    bindings,
  }: {
    bindings: Array<{
      id: string;
      role: string;
      customRoleId: string | null;
      scopeType: string;
      scopeId: string;
    }>;
  }) {
    const orgIds = new Set<string>();
    const teamIds = new Set<string>();
    const projectIds = new Set<string>();
    const customRoleIds = new Set<string>();
    for (const b of bindings) {
      if (b.scopeType === "ORGANIZATION") orgIds.add(b.scopeId);
      else if (b.scopeType === "TEAM") teamIds.add(b.scopeId);
      else if (b.scopeType === "PROJECT") projectIds.add(b.scopeId);
      if (b.customRoleId) customRoleIds.add(b.customRoleId);
    }

    const [orgs, teams, projects, customRoles] = await Promise.all([
      this.repo.findOrgsByIds([...orgIds]),
      this.repo.findTeamsByIds([...teamIds]),
      this.repo.findProjectsByIds([...projectIds]),
      this.repo.findCustomRolesByIds([...customRoleIds]),
    ]);

    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    const teamName = new Map(teams.map((t) => [t.id, t.name]));
    const activeProjectIds = new Set(projects.map((p) => p.id));
    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    const customRoleName = new Map(customRoles.map((r) => [r.id, r.name]));

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
    apiKeys: ApiKeyWithBindings[];
  }) {
    const customRoleIds = new Set<string>();
    const userIds = new Set<string>();
    for (const k of apiKeys) {
      for (const rb of k.roleBindings) {
        if (rb.customRoleId) customRoleIds.add(rb.customRoleId);
      }
      if (k.userId) userIds.add(k.userId);
      if (k.createdByUserId) userIds.add(k.createdByUserId);
    }

    const [customRoles, users] = await Promise.all([
      this.repo.findCustomRolesByIds([...customRoleIds]),
      this.repo.findUsersByIds([...userIds]),
    ]);

    return {
      customRoles,
      users,
    };
  }
}
