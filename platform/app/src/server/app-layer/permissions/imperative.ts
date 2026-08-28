/**
 * ADR-092 decision 25 — the imperative checks, App-routed.
 *
 * Two families, named for what they return:
 *
 * - `require*` throws on denial and returns the {@link Authorized} witness —
 *   the default. A downstream function that takes the witness instead of a
 *   raw id cannot be reached by a path that skipped the check.
 * - `probe*` answers a boolean, for the call sites that genuinely branch
 *   (custom refusal bodies, capability discovery). The name says the caller
 *   owns what happens on `false`, and it is deliberately NOT `has*Permission`:
 *   the legacy `has{Project,Team,Organization}Permission` twins still live in
 *   `server/api/rbac.ts` for the tRPC routers not yet migrated off them, and a
 *   new `has*` here would be a name collision a test mock could bind the wrong
 *   one of. Those twins are being retired; new code uses this facade.
 *
 * The decision resolves through the App the request context carries
 * (`ctx.app`, injected by the tRPC and Hono context factories) or the
 * process singleton, never by handing a database client around. An
 * unauthenticated context is refused before any id is read.
 */
import type { Authorized, AuthzPermission } from "@langwatch/authz-contract";
import { PermissionDeniedError } from "@langwatch/authz-contract";
import type { Session } from "~/server/auth";
import { type App, getApp } from "../app";

type ImperativeContext = {
  session: Session | null;
  /** The composed App the context factory injected (tRPC ctx / Hono var). */
  app?: Pick<App, "permissions">;
};

async function decide({
  ctx,
  tier,
  id,
  permission,
}: {
  ctx: ImperativeContext;
  tier: "project" | "team" | "organization";
  id: string;
  permission: AuthzPermission;
}): Promise<boolean> {
  if (!ctx.session?.user) return false;
  const { permitted } = await (ctx.app ?? getApp()).permissions.getDecision({
    userId: ctx.session.user.id,
    permission,
    scope: { tier, id },
  });
  return permitted;
}

/** Whether the context's user holds `permission` on the project. */
export async function probeProjectPermission(
  ctx: ImperativeContext,
  projectId: string,
  permission: AuthzPermission,
): Promise<boolean> {
  return decide({ ctx, tier: "project", id: projectId, permission });
}

/** Whether the context's user holds `permission` on the team. */
export async function probeTeamPermission(
  ctx: ImperativeContext,
  teamId: string,
  permission: AuthzPermission,
): Promise<boolean> {
  return decide({ ctx, tier: "team", id: teamId, permission });
}

/** Whether the context's user holds `permission` on the organization. */
export async function probeOrganizationPermission(
  ctx: ImperativeContext,
  organizationId: string,
  permission: AuthzPermission,
): Promise<boolean> {
  return decide({ ctx, tier: "organization", id: organizationId, permission });
}

async function requireAtTier<Tier extends "project" | "team" | "organization">({
  ctx,
  tier,
  id,
  permission,
}: {
  ctx: ImperativeContext;
  tier: Tier;
  id: string;
  permission: AuthzPermission;
}): Promise<Authorized<Tier>> {
  if (!ctx.session?.user) {
    throw new PermissionDeniedError({
      permission,
      scope: { type: tier, id },
      denialReason: "no-binding",
    });
  }
  const permissions = (ctx.app ?? getApp()).permissions;
  const scope = await permissions.tryResolveScope({
    ...(tier === "project"
      ? { projectId: id }
      : tier === "team"
        ? { teamId: id }
        : { organizationId: id }),
  });
  if (!scope || scope.type !== tier) {
    throw new PermissionDeniedError({
      permission,
      scope: { type: tier, id },
      denialReason: "no-binding",
    });
  }
  return permissions.authorize({
    principal: { type: "user", id: ctx.session.user.id },
    permission,
    scope,
  }) as Promise<Authorized<Tier>>;
}

/** Assert `permission` on the project; returns the witness or throws. */
export async function requireProjectPermission(
  ctx: ImperativeContext,
  projectId: string,
  permission: AuthzPermission,
): Promise<Authorized<"project">> {
  return requireAtTier({ ctx, tier: "project", id: projectId, permission });
}

/** Assert `permission` on the team; returns the witness or throws. */
export async function requireTeamPermission(
  ctx: ImperativeContext,
  teamId: string,
  permission: AuthzPermission,
): Promise<Authorized<"team">> {
  return requireAtTier({ ctx, tier: "team", id: teamId, permission });
}

/** Assert `permission` on the organization; returns the witness or throws. */
export async function requireOrganizationPermission(
  ctx: ImperativeContext,
  organizationId: string,
  permission: AuthzPermission,
): Promise<Authorized<"organization">> {
  return requireAtTier({
    ctx,
    tier: "organization",
    id: organizationId,
    permission,
  });
}
