import { TRPCError } from "@trpc/server";

import type { PermissionMiddleware } from "~/server/api/rbac";
import { hasLangyAccess } from "~/server/app-layer/langy/langyAccessGate";

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
