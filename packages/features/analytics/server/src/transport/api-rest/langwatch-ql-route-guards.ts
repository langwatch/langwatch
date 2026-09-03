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

import type { PlatformUrlBuilder } from "@langwatch/api/rest";
import type { LangWatchQLProtections } from "@langwatch/analytics-contract";
import type { SavedWorkbenchChart } from "@langwatch/dashboard-contract";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { NotFoundError } from "@langwatch/handled-error";
import type { ProjectIdentity, ProjectService } from "@langwatch/project-contract";

import { lwqlEnabled } from "../../langwatch-ql/access";
import { LangWatchQLNotEnabledError } from "../../langwatch-ql/errors";
import type { LangWatchQLService } from "../../services/langwatch-ql.service";

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

/**
 * Everything the LangWatchQL analytics SQL family dispatches through that the
 * analytics feature does not own.
 *
 * All of it arrives as a provider rather than an instance, for the reason
 * every packaged family's services do: mounting a family must not force its
 * services to be constructed, which is what lets a document generator build
 * this app with none.
 */
export interface LangWatchQLRestPorts {
  /** The rollout switch the whole surface is behind. */
  featureFlags: () => FeatureFlagService;
  /** The project directory the flag's organization and the tenant key are read from. */
  projects: () => ProjectService;
  /** The governed statement runner and its schema description. */
  langWatchQL: () => LangWatchQLService;
  /**
   * The saved-chart half, as a PORT rather than an import.
   *
   * A saved workbench chart is a DASHBOARD resource with a dashboard
   * lifecycle, and a feature server package may not reach into another
   * feature's server package. The type comes from the dashboard CONTRACT,
   * which is the seam that is allowed to cross.
   */
  charts: () => SavedWorkbenchChartRestService;
  /**
   * The caller's content protections for one project.
   *
   * Resolved by the PROCESS: an API key has no member behind it, so what a
   * key may see is the project's data-privacy policy read for a caller with
   * no session — a resolution that reaches the privacy vertical rather than
   * this one.
   */
  protectionsFor: (input: { projectId: string }) => Promise<LangWatchQLProtections>;
  /** Deep links back into the workbench, built from the deployment's origin. */
  platformUrl: PlatformUrlBuilder;
  /**
   * Renames a saved-chart refusal onto the wire code this family publishes.
   *
   * A port for the same reason `charts` is: the mapper is the dashboard
   * feature's, and it always throws.
   */
  mapSavedChartError: (error: unknown) => never;
}

/** The saved-chart operations this family serves, as the dashboard exposes them. */
export interface SavedWorkbenchChartRestService {
  listSavedWorkbenchCharts(input: { projectId: string }): Promise<SavedWorkbenchChart[]>;
  getSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChart>;
  createSavedWorkbenchChart(input: {
    projectId: string;
    protections: LangWatchQLProtections;
    name: string;
    definition: unknown;
  }): Promise<SavedWorkbenchChart>;
  updateSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    name?: string;
    definitionUpdate?: { definition: unknown; protections: LangWatchQLProtections };
  }): Promise<SavedWorkbenchChart>;
  deleteSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<void>;
  placeSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    dashboardId: string;
    gridColumn?: number;
    gridRow?: number;
    colSpan?: number;
    rowSpan?: number;
  }): Promise<SavedWorkbenchChart>;
  unplaceSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<void>;
}
