/**
 * The two checks every governed analytics SQL route runs before it does
 * anything.
 *
 * They live here rather than beside one route file because there is more than
 * one now, and a copied gate is how a surface ends up switched on for a
 * population the other surface refuses: the flag lookup below resolves the
 * project's *organization*, and a second copy that forgot to would silently
 * answer "off" for every organization-scoped grant.
 *
 * @see specs/analytics/governed-sql-api.feature
 * @see specs/analytics/governed-sql-saved-charts.feature
 */

import { NotFoundError } from "@langwatch/handled-error";
import type { Project } from "~/generated/prisma/client";

import { GovernedSqlNotEnabledError } from "~/server/analytics/governed-sql/errors";
import { prisma } from "~/server/db";
import { featureFlagService } from "~/server/featureFlag";

/**
 * The project this request runs for, having checked the URL agrees with the
 * credential.
 *
 * Returns the credential's project, never the one the path named — so even a
 * future refactor that forgot the check could not widen scope, because the id
 * from the URL is never what anything downstream reads.
 *
 * @throws {NotFoundError} `project_not_found` when the path names anything
 *   other than the credential's own project. Not found rather than forbidden,
 *   because whether another project exists is not the caller's to learn.
 */
export function callerProject({
  project,
  requestedProjectId,
}: {
  project: Project;
  requestedProjectId: string | undefined;
}): Project {
  if (requestedProjectId !== project.id) {
    throw new NotFoundError(
      "project_not_found",
      "Project",
      requestedProjectId ?? "",
    );
  }
  return project;
}

/**
 * The experimental gate over the whole surface, same flag as the workbench's
 * tRPC router. Checked per request and server-side only; an API key has no
 * member behind it, so the project is the distinct identity.
 *
 * @throws {GovernedSqlNotEnabledError} when the flag is off for this project.
 */
export async function requireGovernedSqlEnabled(
  project: Project,
): Promise<void> {
  // The flag store's organization-scoped rules fail closed when the calling
  // context has no organization, so the gate resolves the project's — without
  // this, a rule enabling the surface for an organization could never match.
  const team = await prisma.team.findUnique({
    where: { id: project.teamId },
    select: { organizationId: true },
  });
  const enabled = await featureFlagService.isEnabled(
    "release_governed_sql_workbench",
    {
      distinctId: project.id,
      projectId: project.id,
      organizationId: team?.organizationId,
    },
  );
  if (!enabled) throw new GovernedSqlNotEnabledError();
}
