/**
 * The experimental gate over the whole governed SQL workbench surface.
 *
 * One flag, one evaluation, shared by every entry point — the query router, the
 * saved-chart router, and whatever reaches the surface next. Two callers
 * evaluating the same flag differently is not a style problem: it is a member
 * who can run a query but not save it, or the reverse, depending on which
 * question the browser asked first.
 *
 * The organization is resolved and offered alongside the project because a flag
 * rule may target either. Without it an organization-scoped rule silently never
 * matches, which reads as "the switch is off for everyone" — a gate that fails
 * closed for the wrong reason is indistinguishable from one that works, right
 * up until somebody grants the flag to an organization and nothing happens.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 * @see specs/analytics/governed-sql-saved-charts.feature
 */

import type { PrismaClient } from "~/generated/prisma/client";

import { featureFlagService } from "~/server/featureFlag";

/** The one switch the whole workbench surface is behind. */
export const GOVERNED_SQL_WORKBENCH_FLAG = "release_governed_sql_workbench";

/**
 * Whether the workbench surface is switched on for this member and project.
 *
 * Evaluated server-side, so nothing in the browser can force it on.
 */
export async function workbenchEnabled({
  userId,
  projectId,
  prisma,
}: {
  userId: string;
  projectId: string;
  prisma: PrismaClient;
}): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { team: { select: { organizationId: true } } },
  });
  const organizationId = project?.team?.organizationId;

  return await featureFlagService.isEnabled(GOVERNED_SQL_WORKBENCH_FLAG, {
    distinctId: userId,
    projectId,
    // Omitted rather than passed as undefined when the project cannot be read:
    // a rule matching on the organization should not be handed a value this
    // function guessed at.
    ...(organizationId ? { organizationId } : {}),
  });
}
