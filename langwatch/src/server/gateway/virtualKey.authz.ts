import { OrganizationUserRole, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import type { Session } from "~/server/auth";
import {
  hasOrganizationPermission,
  hasProjectPermission,
  hasTeamPermission,
  type Permission,
} from "../api/rbac";

/**
 * Scope-aware authorization for VirtualKey write paths.
 *
 * A VirtualKey carries N `VirtualKeyScope` rows (ORGANIZATION / TEAM /
 * PROJECT). The org-wide `virtualKeys:manage` gate on the router was too
 * coarse: a team admin could mint or mutate org-level keys, and an
 * org-level grant was required even to manage a single team's keys. These
 * helpers move enforcement onto the individual scopes the call actually
 * touches, using the existing `virtualKeys:*` permission vocabulary.
 *
 * Two shapes, matching the feature contract
 * (specs/ai-gateway/governance/vk-scope-rbac.feature):
 *
 *   - CREATE authorizes against the *requested* scope set: the caller must
 *     hold `virtualKeys:manage` on EVERY scope (fail-closed intersection,
 *     so a team admin can't sneak a second team onto the key).
 *   - UPDATE / ROTATE / DELETE authorize against the key's *existing*
 *     scope set: the caller must hold the op permission on AT LEAST ONE of
 *     the scopes the key is already reachable from.
 *
 * The upward cascade (a broader grant covers narrower scopes) is handled
 * inside the rbac helpers: `hasTeamPermission` also reads the org-scoped
 * binding, `hasProjectPermission` reads the team + org bindings.
 *
 * No new code here relies on the legacy `TeamUserRole.ADMIN` short-circuit
 * in rbac.ts — every gate is an explicit per-scope permission check, so
 * the eventual legacy-role-removal drops the short-circuit without a sweep
 * (the @no-short-circuit invariant in the feature file).
 */
export type RBACContext = { prisma: PrismaClient; session: Session | null };

export type Scope = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

function scopeLabel(scope: Scope): string {
  return `${scope.scopeType}:${scope.scopeId}`;
}

async function hasPermissionAtScope(
  ctx: RBACContext,
  scope: Scope,
  permission: Permission,
): Promise<boolean> {
  if (!ctx.session) return false;
  if (scope.scopeType === "ORGANIZATION") {
    return hasOrganizationPermission(
      { prisma: ctx.prisma, session: ctx.session },
      scope.scopeId,
      permission,
    );
  }
  if (scope.scopeType === "TEAM") {
    return hasTeamPermission(ctx, scope.scopeId, permission);
  }
  return hasProjectPermission(ctx, scope.scopeId, permission);
}

/**
 * Create gate: require `virtualKeys:manage` on every requested scope.
 * Throws FORBIDDEN naming the first unauthorized scope so the caller sees
 * exactly which grant is missing.
 */
export async function assertCanManageAllScopes(
  ctx: RBACContext,
  scopes: Scope[],
): Promise<void> {
  if (!ctx.session) {
    throw new TRPCError({ code: "FORBIDDEN", message: "permission_denied" });
  }
  for (const scope of scopes) {
    if (!(await hasPermissionAtScope(ctx, scope, "virtualKeys:manage"))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `permission_denied: virtualKeys:manage at ${scopeLabel(scope)}`,
      });
    }
  }
}

/**
 * Update / rotate / delete gate: require the op permission on at least one
 * of the key's existing scopes. Throws FORBIDDEN when the caller holds it
 * on none of them.
 */
export async function assertCanOperateOnAnyScope(
  ctx: RBACContext,
  scopes: Scope[],
  permission: Permission,
): Promise<void> {
  if (ctx.session) {
    for (const scope of scopes) {
      if (await hasPermissionAtScope(ctx, scope, permission)) return;
    }
  }
  throw new TRPCError({
    code: "FORBIDDEN",
    message: `permission_denied: ${permission} at one of the virtual key's scopes`,
  });
}

/**
 * The set of scopes a user can reach by *membership* within one org:
 *   - `isOrgMember`  — has an OrganizationUser row for the org.
 *   - `teamIds`      — teams in the org the user belongs to (TeamUser).
 *   - `projectIds`   — projects living in any of those teams.
 *
 * List/read visibility is membership-based, not permission-based: a VK is
 * visible when one of its scopes intersects this set (vk-scope-rbac.feature
 * "A user sees VKs whose scopes intersect their membership set"). A plain
 * org member with no `virtualKeys:view` grant still sees org-scoped keys,
 * and a team member sees that team's keys — but not a sibling team's.
 */
export type MembershipSet = {
  isOrgMember: boolean;
  /**
   * The caller is an ORG-level admin. Admins manage the whole org, so VK
   * visibility short-circuits to "sees everything in the org" (see
   * `isVisibleToMembership`). Real org owners hold no per-team `TeamUser`
   * rows, so without this the per-project auto-provisioned Langy VK is
   * invisible to the very admin who owns it.
   */
  isOrgAdmin: boolean;
  teamIds: Set<string>;
  projectIds: Set<string>;
};

export async function loadMembershipSet(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
): Promise<MembershipSet> {
  const [orgMembership, teamMemberships] = await Promise.all([
    prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true },
    }),
    prisma.teamUser.findMany({
      where: { userId, team: { organizationId } },
      select: { teamId: true },
    }),
  ]);
  const teamIds = new Set(teamMemberships.map((t) => t.teamId));
  const projects =
    teamIds.size > 0
      ? await prisma.project.findMany({
          where: { teamId: { in: [...teamIds] } },
          select: { id: true },
        })
      : [];
  return {
    isOrgMember: orgMembership !== null,
    isOrgAdmin: orgMembership?.role === OrganizationUserRole.ADMIN,
    teamIds,
    projectIds: new Set(projects.map((p) => p.id)),
  };
}

export function isVisibleToMembership(
  membership: MembershipSet,
  scopes: Scope[],
): boolean {
  // Org admins manage the whole org, so list/get visibility mirrors the
  // permission cascade (an org binding already covers team + project). The
  // list/get procedures only ever pass VKs already scoped to the caller's
  // org, so a blanket `true` here can't leak another org's keys. Without
  // this, the auto-provisioned per-project Langy VK is invisible to the org
  // admin who owns it (real admins hold no per-team TeamUser rows).
  if (membership.isOrgAdmin) return true;
  return scopes.some((scope) => {
    if (scope.scopeType === "ORGANIZATION") return membership.isOrgMember;
    if (scope.scopeType === "TEAM")
      return membership.teamIds.has(scope.scopeId);
    return membership.projectIds.has(scope.scopeId);
  });
}
