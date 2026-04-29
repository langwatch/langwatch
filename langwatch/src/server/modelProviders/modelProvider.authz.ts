import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { Session } from "~/server/auth";
import {
  hasOrganizationPermission,
  hasProjectPermission,
  hasTeamPermission,
} from "../api/rbac";

/**
 * Minimum shape the RBAC helpers need. Matches the tRPC ctx slice that
 * existing checkXxxPermission middlewares consume, but lets this module
 * be called from any server-side caller (workers, REST routes, etc.).
 */
type RBACContext = { prisma: PrismaClient; session: Session | null };

/**
 * Scope-aware authorization for ModelProvider write paths.
 *
 * The refactored create / update / delete operations can affect N scope
 * entries in one call. This module guarantees fail-closed behavior: if
 * the caller doesn't hold the matching manage-permission on any single
 * scope entry, the whole operation is rejected. Partial-success would
 * let a team admin silently rewrite an org-level row they can't see,
 * which is the first vector rchaves flagged.
 *
 * Read paths use the lighter `assertCanReadScope` — a scope entry is
 * "readable" when the caller has any membership that grants access to
 * that scope tier; unreadable rows must surface as NOT_FOUND instead
 * of FORBIDDEN so clients can't enumerate ids across tenants.
 */

export type Scope = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

/**
 * Permission required to write (create / update / delete) a row whose
 * scope entry points at the given tier.
 */
export function requiredManagePermission(
  scopeType: Scope["scopeType"],
): "organization:manage" | "team:manage" | "project:manage" {
  if (scopeType === "ORGANIZATION") return "organization:manage";
  if (scopeType === "TEAM") return "team:manage";
  return "project:manage";
}

async function canManageScope(ctx: RBACContext, scope: Scope): Promise<boolean> {
  if (!ctx.session) return false;
  if (scope.scopeType === "ORGANIZATION") {
    return hasOrganizationPermission(
      { prisma: ctx.prisma, session: ctx.session },
      scope.scopeId,
      "organization:manage",
    );
  }
  if (scope.scopeType === "TEAM") {
    return hasTeamPermission(ctx, scope.scopeId, "team:manage");
  }
  return hasProjectPermission(ctx, scope.scopeId, "project:manage");
}

/**
 * Throws FORBIDDEN if the caller cannot manage the given scope. Fires
 * on every entry in a multi-scope write — no partial success.
 */
export async function assertCanManageScope(
  ctx: RBACContext,
  scope: Scope,
): Promise<void> {
  const ok = await canManageScope(ctx, scope);
  if (!ok) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You need ${requiredManagePermission(
        scope.scopeType,
      )} on this ${scope.scopeType.toLowerCase()} to assign a model provider to it.`,
    });
  }
}

/**
 * Assert the caller can manage every scope in the given list. Fails
 * atomically on the first scope that fails authz — no entry is
 * partially applied.
 */
export async function assertCanManageAllScopes(
  ctx: RBACContext,
  scopes: Scope[],
): Promise<void> {
  for (const scope of scopes) {
    await assertCanManageScope(ctx, scope);
  }
}

async function canReadScope(ctx: RBACContext, scope: Scope): Promise<boolean> {
  // Read access uses any :view permission on the matching tier. If the
  // caller has no role binding that covers the scope, the row is
  // invisible — getById surfaces NOT_FOUND instead of FORBIDDEN.
  if (!ctx.session) return false;
  if (scope.scopeType === "ORGANIZATION") {
    return hasOrganizationPermission(
      { prisma: ctx.prisma, session: ctx.session },
      scope.scopeId,
      "organization:view",
    );
  }
  if (scope.scopeType === "TEAM") {
    return hasTeamPermission(ctx, scope.scopeId, "team:view");
  }
  return hasProjectPermission(ctx, scope.scopeId, "project:view");
}

/**
 * True when the caller can see at least one of the row's scope entries.
 * A model provider is visible exactly when this returns true.
 */
export async function canReadAnyScope(
  ctx: RBACContext,
  scopes: Scope[],
): Promise<boolean> {
  for (const scope of scopes) {
    if (await canReadScope(ctx, scope)) return true;
  }
  return false;
}
