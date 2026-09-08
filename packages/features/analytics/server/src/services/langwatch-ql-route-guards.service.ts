/**
 * The two checks every LangWatchQL analytics SQL route runs before anything else.
 * @see specs/analytics/lwql-api.feature
 * @see specs/analytics/lwql-saved-charts.feature
 */

import type { PlatformUrlBuilder, RestCredentialPrincipal } from "@langwatch/api/rest";
import type { LangWatchQLProtections } from "@langwatch/analytics-contract";
import type { SavedWorkbenchChart } from "@langwatch/dashboard-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { NotFoundError } from "@langwatch/handled-error";
import type { ProjectIdentity, ProjectService } from "@langwatch/project-contract";

import { lwqlEnabled } from "../rules/lwql-access.rules.ts";
import { LangWatchQLNotEnabledError } from "@langwatch/analytics-contract";
import type { LangWatchQLService } from "./langwatch-ql.service.ts";

/**
 * The two checks every LangWatchQL analytics SQL route runs before it does
 * anything, and the ordered pair of them every route actually calls.
 */
export class LangWatchQLRouteGuardsService {
  static create(): LangWatchQLRouteGuardsService {
    return new LangWatchQLRouteGuardsService();
  }

  private constructor() {}

  /**
   * The project this request runs for, having checked the URL agrees with the credential.
   */
  callerProject({
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
   * The experimental gate over the whole surface, same flag as the workbench's tRPC router.
   * Checked per request and server-side only; an API key has no member behind it, so the
   * project is the distinct identity.
   */
  async assertEnabled(input: {
    featureFlags: FeatureFlagApi;
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
    if (!enabled) {
      throw new LangWatchQLNotEnabledError();
    }
  }

  /**
   * The project a LangWatchQL analytics SQL request runs for: the credential's, once the path
   * has been checked against it and the surface has been found switched on. Both guards, in
   * this order, on every route in the family.
   */
  async project({
    project,
    featureFlags,
    projects,
    requestedProjectId,
  }: {
    featureFlags: FeatureFlagApi;
    project: ProjectIdentity;
    projects: ProjectService;
    requestedProjectId: string | undefined;
  }): Promise<ProjectIdentity> {
    const resolved = this.callerProject({ project, requestedProjectId });
    await this.assertEnabled({ featureFlags, project: resolved, projects });

    return resolved;
  }
}

/**
 * Everything the LangWatchQL analytics SQL family dispatches through that the analytics feature
 * does not own.
 */
export interface LangWatchQLRestPorts {
  /** The rollout switch the whole surface is behind. */
  featureFlags: () => FeatureFlagApi;
  /** The project directory the flag's organization and the tenant key are read from. */
  projects: () => ProjectService;
  /** The governed statement runner and its schema description. */
  langWatchQL: () => LangWatchQLService;
  /**
   * The saved-chart half, as a PORT rather than an import. A saved workbench chart is a
   * DASHBOARD resource with a dashboard lifecycle, and a feature server package may not reach
   * into another feature's server package.
   */
  charts: () => SavedWorkbenchChartRestService;
  /**
   * The caller's content protections for one project.
   *
   * The credential travels with the project because the two together are the
   * question: what a key may see is its OWN cut, not its holder's, and a
   * narrowed key answering with full project protections is how costs used to
   * escape a key that holds no `cost:view`.
   */
  protectionsFor: (input: {
    projectId: string;
    credential: RestCredentialPrincipal;
  }) => Promise<LangWatchQLProtections>;
  /** Deep links back into the workbench, built from the deployment's origin. */
  platformUrl: PlatformUrlBuilder;
  /**
   * Renames a saved-chart refusal onto the wire code this family publishes. A port for the same
   * reason `charts` is: the mapper is the dashboard feature's, and it always throws.
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
