/**
 * tRPC adapter for the custom-chart-playground's experimental switch.
 *
 * The decision itself stays in `customChartPlaygroundEnabled`; this is only
 * the shape that lets a procedure declare the gate instead of remembering to
 * call it. Written out by hand in every resolver, the gate held only for as
 * long as nobody added an eighth procedure and forgot the line — and a
 * forgotten line does not fail, it quietly serves a flagged surface.
 *
 * Chain it AFTER the router's own `checkProjectPermission`, so a caller is
 * placed by RBAC first and gated by the rollout second: a member who may not
 * touch the project should not learn from the answer whether the experiment is
 * switched on for it.
 *
 * @see ~/server/analytics/dashboard-widgets/access — the decision this adapts
 */

import { customChartPlaygroundEnabled } from "~/server/analytics/dashboard-widgets/access";
import { CustomChartPlaygroundNotEnabledError } from "~/server/analytics/dashboard-widgets/errors";
import type { PermissionMiddleware } from "~/server/api/rbac";

/**
 * Refuses unless the custom-chart-playground switch is on for this project.
 *
 * Reads refuse too, and deliberately: a surface that listed widgets while it
 * was switched off would be announcing a feature the same member cannot use,
 * and the flag is meant to hide the whole thing.
 */
export const enforceCustomChartPlaygroundEnabled: PermissionMiddleware<{
  projectId: string;
}> = async ({ ctx, input, next }) => {
  if (
    !(await customChartPlaygroundEnabled({
      projectId: input.projectId,
      prisma: ctx.prisma,
    }))
  ) {
    throw new CustomChartPlaygroundNotEnabledError();
  }
  return next();
};
