/**
 * The two checks every LangWatchQL analytics SQL route runs before it does
 * anything, and the ordered pair of them every route actually calls.
 *
 * They live here rather than beside one route file because there is more than
 * one now, and a copied gate is how a surface ends up switched on for a
 * population the other surface refuses. The flag itself is read in exactly one
 * place — `lwqlEnabled` — for the same reason: it resolves the project's
 * *organization*, and a second copy that forgot to would silently answer "off"
 * for every organization-scoped grant.
 *
 * @see specs/analytics/lwql-api.feature
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { NotFoundError } from "@langwatch/handled-error";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { ProjectIdentity } from "@langwatch/project-contract";

import { lwqlEnabled } from "~/server/analytics/lwql/access";
import { LangWatchQLNotEnabledError } from "~/server/analytics/lwql/errors";

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
  project: ProjectIdentity;
  requestedProjectId: string | undefined;
}): ProjectIdentity {
  if (requestedProjectId !== project.id) {
    throw new NotFoundError("project_not_found", "Project", requestedProjectId ?? "");
  }
  return project;
}

/**
 * The experimental gate over the whole surface, same flag as the workbench's
 * tRPC router. Checked per request and server-side only; an API key has no
 * member behind it, so the project is the distinct identity.
 *
 * @throws {LangWatchQLNotEnabledError} when the flag is off for this project.
 */
export async function requireLangWatchQLEnabled(input: {
  featureFlags: FeatureFlagService;
  project: ProjectIdentity;
  projects: ProjectService;
}): Promise<void> {
  // Asked through `lwqlEnabled` rather than evaluated here: it is the
  // one place the flag is read, so this boundary and the tRPC one cannot drift
  // into answering the same question differently.
  const enabled = await lwqlEnabled({
    featureFlags: input.featureFlags,
    projectId: input.project.id,
    projects: input.projects,
  });
  if (!enabled) throw new LangWatchQLNotEnabledError();
}

/**
 * The project a LangWatchQL analytics SQL request runs for: the credential's, once
 * the path has been checked against it and the surface has been found switched
 * on.
 *
 * Both guards, in this order, on every route in the family. The order is the
 * claim: a path naming another project is refused before the flag is consulted,
 * so a caller cannot use the two answers together to learn which projects exist
 * on a deployment that has the surface switched off.
 *
 * It lives here rather than beside either route file because both of them need
 * it, and a second copy is exactly how one surface ends up running one guard.
 *
 * @throws {NotFoundError} `project_not_found` — see {@link callerProject}.
 * @throws {LangWatchQLNotEnabledError} — see {@link requireLangWatchQLEnabled}.
 */
export async function lwqlProject({
  project,
  featureFlags,
  projects,
  requestedProjectId,
}: {
  featureFlags: FeatureFlagService;
  project: ProjectIdentity;
  projects: ProjectService;
  requestedProjectId: string | undefined;
}): Promise<ProjectIdentity> {
  const resolved = callerProject({ project, requestedProjectId });
  await requireLangWatchQLEnabled({ featureFlags, project: resolved, projects });
  return resolved;
}
