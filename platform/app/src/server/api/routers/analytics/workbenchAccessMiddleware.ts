/**
 * tRPC adapter for the LangWatchQL workbench's experimental switch.
 *
 * The decision itself stays in `lwqlEnabled`; this is only the shape that
 * lets a procedure declare the gate instead of remembering to call it. Written
 * out by hand in every resolver, the gate held only for as long as nobody added
 * a sixth procedure and forgot the line — and a forgotten line does not fail,
 * it quietly serves a flagged surface.
 *
 * Chain it AFTER the router's own `checkProjectPermission`, so a caller is
 * placed by RBAC first and gated by the rollout second: a member who may not
 * touch the project should not learn from the answer whether the experiment is
 * switched on for it.
 *
 * @see ~/server/analytics/lwql/access — the decision this adapts
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { lwqlEnabled } from "~/server/analytics/lwql/access";
import { LangWatchQLNotEnabledError } from "~/server/analytics/lwql/errors";
import type { PermissionMiddleware } from "~/server/api/rbac";

/**
 * Refuses unless the workbench switch is on for this project.
 *
 * Reads refuse too, and deliberately: a surface that listed charts while it was
 * switched off would be announcing a feature the same member cannot use, and
 * the flag is meant to hide the whole thing.
 */
export const enforceWorkbenchEnabled: PermissionMiddleware<{
  projectId: string;
}> = async ({ ctx, input, next }) => {
  const app = ctx.app;
  if (!app) {
    throw new Error("Application context is missing from the LangWatchQL transport.");
  }

  if (
    !(await lwqlEnabled({
      featureFlags: app.featureFlags,
      projectId: input.projectId,
      projects: app.projects,
    }))
  ) {
    // A typed handled error, not a bare FORBIDDEN: `handledErrorMiddleware`
    // serialises `code: "lwql_not_enabled"` onto the wire, which is
    // what the workbench keys its copy off.
    throw new LangWatchQLNotEnabledError();
  }
  return next();
};
