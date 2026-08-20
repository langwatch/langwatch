/**
 * ADR-092 decision 25 — the imperative boolean checks, App-routed.
 *
 * Same names and signatures as the legacy `rbac.ts` wrappers they replace, so
 * a call site changes only its import — but the decision now resolves through
 * the App the request context carries (`ctx.app`, injected by the tRPC and
 * Hono context factories) or the process singleton, never by handing a
 * database client around. An unauthenticated context is refused before any
 * id is read.
 */
import type { AuthzPermission } from "@langwatch/authz";
import type { Session } from "~/server/auth";
import { type App, getApp } from "../app";

type ImperativeContext = {
  session: Session | null;
  /** The composed App the context factory injected (tRPC ctx / Hono var). */
  app?: App;
};

async function decide(
  ctx: ImperativeContext,
  tier: "project" | "team" | "organization",
  id: string,
  permission: AuthzPermission,
): Promise<boolean> {
  if (!ctx.session?.user) return false;
  const { permitted } = await (ctx.app ?? getApp()).permissions.getDecision({
    userId: ctx.session.user.id,
    permission,
    scope: { tier, id },
  });
  return permitted;
}

/** Whether the context's user holds `permission` on the project. */
export async function hasProjectPermission(
  ctx: ImperativeContext,
  projectId: string,
  permission: AuthzPermission,
): Promise<boolean> {
  return decide(ctx, "project", projectId, permission);
}

/** Whether the context's user holds `permission` on the team. */
export async function hasTeamPermission(
  ctx: ImperativeContext,
  teamId: string,
  permission: AuthzPermission,
): Promise<boolean> {
  return decide(ctx, "team", teamId, permission);
}

/** Whether the context's user holds `permission` on the organization. */
export async function hasOrganizationPermission(
  ctx: ImperativeContext,
  organizationId: string,
  permission: AuthzPermission,
): Promise<boolean> {
  return decide(ctx, "organization", organizationId, permission);
}
