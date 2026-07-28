import { TRPCError } from "@trpc/server";

import { isDemoProjectId, type PermissionMiddleware } from "~/server/api/rbac";
import { hasLangyAccess } from "~/server/app-layer/langy/langyAccessGate";
import { LangyNotEnabledError } from "~/server/app-layer/langy/errors";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";

/**
 * Refuses the demo project outright. `DEMO_VIEW_PERMISSIONS` grants Langy's
 * read permission to every authenticated user on the demo project, so a
 * permission check alone would expose it there; the server never runs Langy on
 * the demo project, so the refusal is explicit. One definition, chained by
 * every customer-facing Langy procedure (`langy`, `langyEgress`) between the
 * permission check and `enforceLangyAccess`, so the three routers cannot drift.
 */
export const refuseDemoProject: PermissionMiddleware<{
  projectId: string;
}> = async ({ input, next }) => {
  if (isDemoProjectId(input.projectId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Langy is not available on the demo project.",
    });
  }
  return next();
};

/**
 * tRPC adapter for the authoritative Langy access decision (`hasLangyAccess`).
 *
 * Applied to every customer-facing Langy router (`langy`, `langyGithub`,
 * `langyEgress`) so the internal-only gate lives in exactly one decision. A
 * denied caller gets `NOT_FOUND`, never `FORBIDDEN`: the gate must not double as
 * a probe for whether Langy exists for the account. It reads whichever scope the
 * procedure carries — `projectId` (langy, langyEgress) or `organizationId`
 * (langyGithub) — so project- and org-scoped rollout rules both resolve. Chain
 * it AFTER the router's own permission/membership middleware so an ordinary
 * caller is placed by RBAC first and gated by the rollout second.
 */
export const enforceLangyAccess: PermissionMiddleware<{
  projectId?: string;
  organizationId?: string;
}> = async ({ ctx, input, next }) => {
  // An ORG-scoped rollout rule needs an organization to match against, and the
  // project-scoped procedures (`langy`, `langyEgress`) only ever carry a
  // projectId — so reading the scope straight off the input silently evaluated
  // those calls with no org at all, and every org-targeted rule missed. The
  // account was opted in and the API said "not enabled".
  //
  // Resolved from the project instead (cached, ten minutes), so both rule kinds
  // resolve on every surface. An explicit organizationId on the input still
  // wins: `langyGithub` is org-scoped and has the real one.
  const organizationId =
    input.organizationId ??
    (input.projectId ? await resolveOrganizationId(input.projectId) : undefined);

  const allowed = await hasLangyAccess({
    user: ctx.session.user,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(organizationId ? { organizationId } : {}),
  });
  if (!allowed) {
    // A typed handled error, not a bare NOT_FOUND: `handledErrorMiddleware` maps
    // its 404 to the tRPC code and serialises `code: "langy_not_enabled"` onto
    // the wire, so the client tells a rollout gate apart from a load failure.
    throw new LangyNotEnabledError();
  }
  return next();
};
