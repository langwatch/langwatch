import type { PrismaClient, PersonalAccessToken } from "@prisma/client";
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { PatRepository, type PatWithBindings } from "./pat.repository";
import {
  generatePatToken,
  splitPatToken,
  verifySecret,
} from "./pat-token.utils";
import {
  PatAlreadyRevokedError,
  PatNotFoundError,
  PatNotOwnedError,
  PatScopeViolationError,
} from "./errors";
import type { Permission } from "~/server/api/rbac";
import { checkRoleBindingPermission } from "~/server/rbac/role-binding-resolver";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:pat:service");

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

export class PatService {
  private readonly repo: PatRepository;
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.repo = PatRepository.create(prisma);
  }

  static create(prisma: PrismaClient): PatService {
    return new PatService(prisma);
  }

  /**
   * Creates a new PAT with the given role bindings inside a transaction.
   * Returns the plaintext token (shown once) plus the persisted record.
   *
   * Enforces two invariants before persisting:
   *   1. The creator is a member of the target organization.
   *   2. Every requested binding is within the creator's own ceiling — a user
   *      cannot mint a PAT that grants permissions they do not themselves
   *      hold at the requested scope. Violations throw `PatScopeViolationError`.
   */
  async create({
    name,
    description,
    userId,
    organizationId,
    expiresAt,
    bindings,
  }: {
    name: string;
    description?: string | null;
    userId: string;
    organizationId: string;
    expiresAt?: Date | null;
    bindings: RoleBindingInput[];
  }): Promise<{ token: string; pat: PersonalAccessToken }> {
    await this.assertOrgMembership({ userId, organizationId });
    await this.assertBindingsWithinCeiling({
      creatorUserId: userId,
      organizationId,
      bindings,
    });

    const { token, lookupId, hashedSecret } = generatePatToken();

    const pat = await this.prisma.$transaction(async (tx) => {
      const txRepo = PatRepository.create(tx as PrismaClient);

      const created = await txRepo.create({
        name,
        description,
        lookupId,
        hashedSecret,
        userId,
        organizationId,
        expiresAt,
      });

      if (bindings.length > 0) {
        await txRepo.createRoleBindings({
          patId: created.id,
          organizationId,
          bindings,
        });
      }

      return created;
    });

    return { token, pat };
  }

  /**
   * Verifies the creator is a member of the org before a PAT can be minted.
   * The router's RBAC middleware is intentionally skipped (users create PATs
   * for their own orgs), so this is the authoritative membership check.
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
      throw new PatScopeViolationError("Not a member of this organization", {
        meta: { userId, organizationId },
      });
    }
  }

  /**
   * Validates every requested binding against the creator's own permissions.
   *
   * For each binding we resolve the target scope (ORG / TEAM / PROJECT),
   * verifying the scope actually belongs to the enclosing organization so
   * users cannot cross-tenant grant. Then we check the creator holds the
   * permission the PAT would receive — for CUSTOM roles this means walking
   * every permission in the custom role's permission set; for built-in roles
   * it means checking a representative ceiling permission (ADMIN → manage,
   * MEMBER → create, VIEWER → view).
   */
  private async assertBindingsWithinCeiling({
    creatorUserId,
    organizationId,
    bindings,
  }: {
    creatorUserId: string;
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
          creatorUserId,
          organizationId,
          scope,
          customRoleId: binding.customRoleId ?? null,
        });
      } else {
        await this.assertBuiltinRoleWithinCeiling({
          creatorUserId,
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
        throw new PatScopeViolationError(
          "Organization scope must match the PAT's organization",
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
        throw new PatScopeViolationError(
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
      throw new PatScopeViolationError(
        `Project ${binding.scopeId} not found or archived`,
        { meta: { projectId: binding.scopeId } },
      );
    }
    if (project.team.organizationId !== organizationId) {
      throw new PatScopeViolationError(
        `Project ${binding.scopeId} does not belong to this organization`,
        { meta: { projectId: binding.scopeId, organizationId } },
      );
    }
    return { type: "project", id: binding.scopeId, teamId: project.team.id };
  }

  private async assertCustomRoleWithinCeiling({
    creatorUserId,
    organizationId,
    scope,
    customRoleId,
  }: {
    creatorUserId: string;
    organizationId: string;
    scope: CreatorScope;
    customRoleId: string | null;
  }): Promise<void> {
    if (!customRoleId) {
      throw new PatScopeViolationError("CUSTOM role requires a customRoleId");
    }
    const customRole = await this.prisma.customRole.findUnique({
      where: { id: customRoleId, organizationId },
      select: { permissions: true },
    });
    if (!customRole) {
      throw new PatScopeViolationError(
        `Custom role ${customRoleId} not found`,
        { meta: { customRoleId, organizationId } },
      );
    }
    const perms = Array.isArray(customRole.permissions)
      ? (customRole.permissions as string[])
      : [];
    for (const perm of perms) {
      const userHas = await checkRoleBindingPermission({
        prisma: this.prisma,
        principal: { type: "user", id: creatorUserId },
        organizationId,
        scope,
        permission: perm as Permission,
      });
      if (!userHas) {
        throw new PatScopeViolationError(
          `Cannot grant permission "${perm}" — exceeds your own access`,
          { meta: { permission: perm, scope } },
        );
      }
    }
  }

  private async assertBuiltinRoleWithinCeiling({
    creatorUserId,
    organizationId,
    scope,
    role,
  }: {
    creatorUserId: string;
    organizationId: string;
    scope: CreatorScope;
    role: "ADMIN" | "MEMBER" | "VIEWER";
  }): Promise<void> {
    const representativePermission: Permission =
      role === TeamUserRole.ADMIN
        ? "project:manage"
        : role === TeamUserRole.MEMBER
          ? "project:create"
          : "project:view";

    const userHasPermission = await checkRoleBindingPermission({
      prisma: this.prisma,
      principal: { type: "user", id: creatorUserId },
      organizationId,
      scope,
      permission: representativePermission,
    });

    if (!userHasPermission) {
      throw new PatScopeViolationError(
        `Cannot create PAT with ${role} permissions — exceeds your own access at ${scope.type}:${scope.id}`,
        { meta: { role, scope } },
      );
    }
  }

  /**
   * Verifies a PAT token string and returns the token record if valid.
   * Returns null if the token is invalid, revoked, or not found.
   *
   * Does NOT update lastUsedAt — callers should call markUsed() after
   * confirming the request is fully authorized (e.g., project resolved).
   */
  async verify({
    token,
  }: {
    token: string;
  }): Promise<PatWithBindings | null> {
    const parts = splitPatToken(token);
    if (!parts) return null;

    const pat = await this.repo.findByLookupId({ lookupId: parts.lookupId });
    if (!pat) return null;

    // Revoked tokens are rejected
    if (pat.revokedAt) return null;

    // Expired tokens are rejected
    if (pat.expiresAt && pat.expiresAt < new Date()) return null;

    // Verify the secret portion
    if (!verifySecret(parts.secret, pat.hashedSecret)) return null;

    return pat;
  }

  /**
   * Fire-and-forget lastUsedAt update. Call after full authorization succeeds.
   *
   * Errors are logged rather than swallowed silently so lastUsedAt drift
   * between the DB and the token's true usage is visible in operational
   * logs (disk pressure, connection churn, migrations in flight, etc.).
   */
  markUsed({ id }: { id: string }): void {
    this.repo.updateLastUsedAt({ id }).catch((err: unknown) => {
      logger.warn(
        { err, patId: id },
        "failed to update PAT lastUsedAt (fire-and-forget)",
      );
    });
  }

  /**
   * Lists all PATs for a user within an organization.
   */
  async list({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<PatWithBindings[]> {
    return this.repo.findAllByUser({ userId, organizationId });
  }

  /**
   * Revokes a PAT by setting revokedAt. Never hard-deletes.
   */
  async revoke({
    id,
    userId,
  }: {
    id: string;
    userId: string;
  }): Promise<PersonalAccessToken> {
    // Verify ownership
    const pat = await this.repo.findById({ id });
    if (!pat) throw new PatNotFoundError(id);
    if (pat.userId !== userId) throw new PatNotOwnedError(id);
    if (pat.revokedAt) throw new PatAlreadyRevokedError(id);

    return this.repo.revoke({ id });
  }

  /**
   * Gets a single PAT by ID (for display, not verification).
   */
  async getById({ id }: { id: string }): Promise<PatWithBindings | null> {
    return this.repo.findById({ id });
  }
}
