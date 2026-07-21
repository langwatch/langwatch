import { TRPCError } from "@trpc/server";

import { isDemoProjectId, type PermissionMiddleware } from "~/server/api/rbac";
import { hasLangyAccess } from "~/server/app-layer/langy/langyAccessGate";

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
  const allowed = await hasLangyAccess({
    user: ctx.session.user,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
  });
  if (!allowed) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Langy is not currently enabled for this account.",
    });
  }
  return next();
};
