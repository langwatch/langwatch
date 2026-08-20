import {
  type AuthzPermission,
  PermissionDeniedError,
  type PermissionScopeArg,
} from "@langwatch/authz";
import type { PrismaClient } from "~/generated/prisma/client";
import { OrganizationUserRole } from "~/generated/prisma/client";
import type { Permission } from "~/server/api/rbac";
import {
  hasOrganizationPermission,
  resolveProjectPermission,
  resolveTeamPermission,
} from "~/server/api/rbac";
import type { Session } from "~/server/auth";
import {
  LiteMemberRestrictedError,
  ProjectPermissionDeniedError,
} from "./errors";

/**
 * Service responsible for project-level permission enforcement.
 *
 * Pure business logic — no tRPC dependency. Safe to call from Hono routes,
 * background workers, or any other non-tRPC surface.
 */
export class PermissionsService {
  constructor(private readonly prisma: PrismaClient) {}

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
    const ctx = {
      prisma: this.prisma,
      // Minimal session shape — resolveProjectPermission only accesses user.id.
      // Other Session fields (expires, sessionId, etc.) are not read by the
      // permission resolver, so we satisfy the interface with an empty expires.
      session: { user: { id: userId }, expires: "" } satisfies Session,
    };

    const { permitted, organizationRole } = await resolveProjectPermission(
      ctx,
      projectId,
      permission,
    );

    if (!permitted) {
      if (organizationRole === OrganizationUserRole.EXTERNAL) {
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
   * through the same fork-aware resolvers every declared `.permission()`
   * runs, so an imperative site and a declared one can never disagree.
   */
  async hasPermission<P extends AuthzPermission>(
    check: { userId: string; permission: P } & PermissionScopeArg<P>,
  ): Promise<boolean> {
    const { permitted } = await this.decide(check);
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
    const { tier, id, permitted, organizationRole } = await this.decide(check);
    if (permitted) return;
    if (organizationRole === OrganizationUserRole.EXTERNAL) {
      throw new LiteMemberRestrictedError(
        check.permission.split(":")[0] ?? "unknown",
      );
    }
    throw new PermissionDeniedError({
      permission: check.permission,
      scope: { type: tier, id },
      denialReason: "no-binding",
    });
  }

  private async decide({
    userId,
    permission,
    ...scope
  }: {
    userId: string;
    permission: AuthzPermission;
  } & Partial<
    Record<"projectId" | "teamId" | "organizationId", string>
  >): Promise<{
    tier: "project" | "team" | "organization";
    id: string;
    permitted: boolean;
    organizationRole: OrganizationUserRole | null;
  }> {
    const ctx = {
      prisma: this.prisma,
      session: { user: { id: userId }, expires: "" } as Session,
    };
    if (scope.projectId) {
      const decision = await resolveProjectPermission(
        ctx,
        scope.projectId,
        permission,
      );
      return { tier: "project", id: scope.projectId, ...decision };
    }
    if (scope.teamId) {
      const decision = await resolveTeamPermission(
        ctx,
        scope.teamId,
        permission,
      );
      return { tier: "team", id: scope.teamId, ...decision };
    }
    if (scope.organizationId) {
      const permitted = await hasOrganizationPermission(
        ctx as { prisma: PrismaClient; session: Session },
        scope.organizationId,
        permission,
      );
      return {
        tier: "organization",
        id: scope.organizationId,
        permitted,
        organizationRole: null,
      };
    }
    // The types make this unreachable; fail closed if they are bypassed.
    return {
      tier: "project",
      id: "unresolved",
      permitted: false,
      organizationRole: null,
    };
  }
}
