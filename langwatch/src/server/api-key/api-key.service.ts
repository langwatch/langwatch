import type { PrismaClient, ApiKey } from "@prisma/client";
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { ApiKeyRepository, type ApiKeyWithBindings } from "./api-key.repository";
import {
  generateApiKeyToken,
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
import {
  parseCustomRolePermissions,
  MalformedCustomRolePermissionsError,
} from "~/server/rbac/custom-role-permissions";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:api-key:service");

type RoleBindingInput = {
  role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
  customRoleId?: string | null;
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

/**
 * Scope shape consumed by `checkRoleBindingPermission`. Mirrors the
 * RoleBindingScopeType enum but carries the enclosing `teamId` for project
 * scopes so hierarchy lookups can walk team → org.
 */
type CreatorScope =
  | { type: "org"; id: string }
  | { type: "team"; id: string }
  | { type: "project"; id: string; teamId: string };

export class ApiKeyService {
  private readonly repo: ApiKeyRepository;
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.repo = ApiKeyRepository.create(prisma);
  }

  static create(prisma: PrismaClient): ApiKeyService {
    return new ApiKeyService(prisma);
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
    bindings,
  }: {
    name: string;
    description?: string | null;
    userId?: string | null;
    createdByUserId?: string | null;
    organizationId: string;
    expiresAt?: Date | null;
    permissionMode: string;
    bindings: RoleBindingInput[];
  }): Promise<{ token: string; apiKey: ApiKey }> {
    // Service keys (no userId) skip user-level checks
    if (userId) {
      await this.assertOrgMembership({ userId, organizationId });
      await this.assertBindingsWithinCeiling({
        ceilingUserId: userId,
        organizationId,
        bindings,
      });
    }

    const { token, lookupId, hashedSecret } = generateApiKeyToken();

    const apiKey = await this.prisma.$transaction(async (tx) => {
      const txRepo = ApiKeyRepository.create(tx);

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
      });

      if (bindings.length > 0) {
        await txRepo.createRoleBindings({
          apiKeyId: created.id,
          organizationId,
          bindings,
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
    bindings,
  }: {
    id: string;
    callerUserId: string;
    callerIsAdmin: boolean;
    organizationId: string;
    name?: string;
    description?: string | null;
    permissionMode?: string;
    bindings?: RoleBindingInput[];
  }): Promise<ApiKeyWithBindings> {
    const existing = await this.repo.findById({ id });
    if (!existing) throw new ApiKeyNotFoundError(id);
    if (existing.organizationId !== organizationId) {
      throw new ApiKeyNotFoundError(id);
    }

    // Service keys (no userId) can only be managed by admins
    // Personal keys can be updated by the owner or admins
    if (!callerIsAdmin) {
      if (!existing.userId || existing.userId !== callerUserId) {
        throw new ApiKeyNotOwnedError(id);
      }
    }

    if (existing.revokedAt) throw new ApiKeyAlreadyRevokedError(id);

    // Validate new bindings against the key owner's ceiling (skip for service keys)
    if (bindings && existing.userId) {
      await this.assertBindingsWithinCeiling({
        ceilingUserId: existing.userId,
        organizationId,
        bindings,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const txRepo = ApiKeyRepository.create(tx);

      await txRepo.update({
        id,
        name,
        description,
        permissionMode,
      });

      if (bindings) {
        await txRepo.replaceRoleBindings({
          apiKeyId: id,
          organizationId,
          bindings,
        });
      }

      const updated = await txRepo.findById({ id });
      if (!updated) throw new ApiKeyNotFoundError(id);
      return updated;
    });
  }

  /**
   * Verifies the creator is a member of the org before an API key can be minted.
   */
  private async assertOrgMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    const orgUser = await this.prisma.organizationUser.findFirst({
      where: { userId, organizationId },
      select: { userId: true },
    });
    if (!orgUser) {
      throw new ApiKeyScopeViolationError("Not a member of this organization", {
        meta: { userId, organizationId },
      });
    }
  }

  /**
   * Validates every requested binding against the ceiling user's permissions.
   */
  private async assertBindingsWithinCeiling({
    ceilingUserId,
    organizationId,
    bindings,
  }: {
    ceilingUserId: string;
    organizationId: string;
    bindings: RoleBindingInput[];
  }): Promise<void> {
    for (const binding of bindings) {
      const scope = await this.resolveAndValidateScope({
        binding,
        organizationId,
      });

      if (binding.role === TeamUserRole.CUSTOM) {
        await this.assertCustomRoleWithinCeiling({
          ceilingUserId,
          organizationId,
          scope,
          customRoleId: binding.customRoleId ?? null,
        });
      } else {
        await this.assertBuiltinRoleWithinCeiling({
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
      const team = await this.prisma.team.findFirst({
        where: { id: binding.scopeId, organizationId },
        select: { id: true },
      });
      if (!team) {
        throw new ApiKeyScopeViolationError(
          `Team ${binding.scopeId} not found in this organization`,
          { meta: { teamId: binding.scopeId, organizationId } },
        );
      }
      return { type: "team", id: binding.scopeId };
    }

    const project = await this.prisma.project.findUnique({
      where: { id: binding.scopeId, archivedAt: null },
      include: { team: { select: { id: true, organizationId: true } } },
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
    ceilingUserId,
    organizationId,
    scope,
    customRoleId,
  }: {
    ceilingUserId: string;
    organizationId: string;
    scope: CreatorScope;
    customRoleId: string | null;
  }): Promise<void> {
    if (!customRoleId) {
      throw new ApiKeyScopeViolationError("CUSTOM role requires a customRoleId");
    }
    const customRole = await this.prisma.customRole.findUnique({
      where: { id: customRoleId, organizationId },
      select: { permissions: true },
    });
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
      if (err instanceof MalformedCustomRolePermissionsError) {
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
        prisma: this.prisma,
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
    ceilingUserId,
    organizationId,
    scope,
    role,
  }: {
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
      prisma: this.prisma,
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

    // Verify the secret portion
    if (!verifySecret(parts.secret, apiKey.hashedSecret)) return null;

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
  }: {
    id: string;
    callerUserId: string;
    callerIsAdmin: boolean;
  }): Promise<ApiKey> {
    const apiKey = await this.repo.findById({ id });
    if (!apiKey) throw new ApiKeyNotFoundError(id);
    if (!callerIsAdmin) {
      if (!apiKey.userId || apiKey.userId !== callerUserId) {
        throw new ApiKeyNotOwnedError(id);
      }
    }
    if (apiKey.revokedAt) throw new ApiKeyAlreadyRevokedError(id);

    return this.repo.revoke({ id });
  }

  /**
   * Gets a single API key by ID (for display, not verification).
   */
  async getById({ id }: { id: string }): Promise<ApiKeyWithBindings | null> {
    return this.repo.findById({ id });
  }
}
