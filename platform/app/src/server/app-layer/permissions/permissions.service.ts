import {
  type AuthzPermission,
  type DeclaredScopeId,
  PermissionDeniedError,
  type PermissionScopeArg,
} from "@langwatch/authz";
import type { Permission } from "~/server/api/rbac";
import {
  LiteMemberRestrictedError,
  ProjectPermissionDeniedError,
} from "./errors";
import type {
  PermissionDecision,
  PermissionDecisionRepository,
} from "./permission-decision.repository";

/**
 * Service responsible for permission enforcement.
 *
 * Pure business logic — no tRPC dependency, no client: decisions come from
 * the injected {@link PermissionDecisionRepository} (compose via
 * `permissionsServiceFor` in `./runtime.ts`). Safe to call from Hono routes,
 * background workers, or any other non-tRPC surface.
 */
export class PermissionsService {
  constructor(private readonly repository: PermissionDecisionRepository) {}

  /**
   * Asserts that a user holds the given permission on a project.
   *
   * Throws {@link LiteMemberRestrictedError} when the denial is caused by the
   * user being a Lite Member (EXTERNAL org role), and
   * {@link ProjectPermissionDeniedError} for every other denial (not a member,
   * or a member whose role does not carry the permission). Both are handled
   * errors carrying a code — callers must never tell them apart by message.
   *
   * @param params.userId     - The authenticated user's ID.
   * @param params.projectId  - The project being accessed.
   * @param params.permission - The permission that must be held.
   */
  async requireProjectPermission({
    userId,
    projectId,
    permission,
  }: {
    userId: string;
    projectId: string;
    permission: Permission;
  }): Promise<void> {
    const { permitted, organizationRole } =
      await this.repository.findProjectDecision({
        userId,
        projectId,
        permission,
      });

    if (!permitted) {
      if (organizationRole === "EXTERNAL") {
        throw new LiteMemberRestrictedError(
          permission.split(":")[0] ?? "unknown",
        );
      }
      throw new ProjectPermissionDeniedError(permission);
    }
  }

  /**
   * ADR-092 decision 25 — the typed imperative check. The scope argument is
   * derived from the permission's registry tiers: exactly one id, at a tier
   * the permission can be granted at, or the call does not compile. Decides
   * through the same repository every declared `.permission()` runs, so an
   * imperative site and a declared one can never disagree.
   */
  async hasPermission<P extends AuthzPermission>(
    check: { userId: string; permission: P } & PermissionScopeArg<P>,
  ): Promise<boolean> {
    const scope = scopeOf(check);
    if (!scope) return false;
    const { permitted } = await this.getDecision({
      userId: check.userId,
      permission: check.permission,
      scope,
    });
    return permitted;
  }

  /**
   * The asserting form of {@link hasPermission}: throws the engine's one
   * denial (`permission_denied`, with the permission and tier in `meta`), or
   * the lite-member restriction where that is the cause.
   */
  async requirePermission<P extends AuthzPermission>(
    check: { userId: string; permission: P } & PermissionScopeArg<P>,
  ): Promise<void> {
    const scope = scopeOf(check);
    if (!scope) {
      throw new PermissionDeniedError({
        permission: check.permission,
        scope: { type: "project", id: "unresolved" },
        denialReason: "no-binding",
      });
    }
    const { permitted, organizationRole } = await this.getDecision({
      userId: check.userId,
      permission: check.permission,
      scope,
    });
    if (permitted) return;
    if (organizationRole === "EXTERNAL") {
      throw new LiteMemberRestrictedError(
        check.permission.split(":")[0] ?? "unknown",
      );
    }
    throw new PermissionDeniedError({
      permission: check.permission,
      scope: { type: scope.tier, id: scope.id },
      denialReason: "no-binding",
    });
  }

  /**
   * The decision at an already-resolved scope — what the declared tRPC seam
   * calls after `declaredScopeId` picks the tier. Each tier maps to the
   * repository method whose answer the legacy middleware for that tier gave.
   */
  async getDecision({
    userId,
    permission,
    scope,
  }: {
    userId: string;
    permission: AuthzPermission;
    scope: DeclaredScopeId;
  }): Promise<PermissionDecision> {
    switch (scope.tier) {
      case "project":
        return await this.repository.findProjectDecision({
          userId,
          projectId: scope.id,
          permission,
        });
      case "team":
        return await this.repository.findTeamDecision({
          userId,
          teamId: scope.id,
          permission,
        });
      case "organization":
        return await this.repository.findOrganizationDecision({
          userId,
          organizationId: scope.id,
          permission,
        });
    }
  }

  /**
   * Any one of `permissions` at the project scope is enough — the decision
   * behind `.permissionAny()`.
   */
  async getProjectAnyDecision({
    userId,
    projectId,
    permissions,
  }: {
    userId: string;
    projectId: string;
    permissions: readonly AuthzPermission[];
  }): Promise<PermissionDecision> {
    return await this.repository.findProjectAnyDecision({
      userId,
      projectId,
      permissions,
    });
  }
}

/**
 * The typed scope argument is exclusive by construction, so exactly one id is
 * present; null is the fail-closed answer for the day the types are bypassed.
 */
function scopeOf(
  scope: Partial<Record<"projectId" | "teamId" | "organizationId", string>>,
): DeclaredScopeId | null {
  if (scope.projectId) return { tier: "project", id: scope.projectId };
  if (scope.teamId) return { tier: "team", id: scope.teamId };
  if (scope.organizationId)
    return { tier: "organization", id: scope.organizationId };
  return null;
}
