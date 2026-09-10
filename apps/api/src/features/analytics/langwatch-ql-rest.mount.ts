/**
 * Binds the saved-workbench-chart REST declaration to this process's project
 * door: `/api/v1/projects/:projectId/analytics/charts*`. A saved chart is a
 * DASHBOARD resource, so the create/read/write operations dispatch through
 * the dashboard application; the rollout gate and the caller's content
 * protections are the SAME ones the `/api/v1/query` door reads, so a
 * statement saved here and one run there are never validated by two answers.
 */
import type { LangWatchQLProtections } from "@langwatch/analytics-contract";
import {
  langWatchQLCallerProtections,
  lwqlEnabled,
  savedWorkbenchChartRest,
  savedWorkbenchChartUrl,
  type LangWatchQLService,
  type SavedWorkbenchChartApi,
} from "@langwatch/analytics-server";
import {
  bindRestMiddleware,
  credentialPrincipalOfToken,
  type MountableRestApp,
  type RestCredentialPrincipal,
} from "@langwatch/api/rest";
import type { DashboardApi } from "@langwatch/dashboard-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import { ApiRestObservabilityComposition } from "../../app/api-rest-observability.composition.ts";
import { createPlatformUrlBuilder } from "../../app/api-rest-ports.ts";
import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/**
 * This family has published the canonical `{ code, message, meta }` envelope
 * since issue #6480, not the flat legacy body the process falls back to: a
 * new family, so it never joined the callers the legacy shape predates.
 */
const canonicalErrors = ApiRestObservabilityComposition.create().canonicalErrorHandler;

/**
 * What the governed-SQL family reaches beyond the dashboard: the rollout
 * switch, the project directory the flag targets by, the restricted
 * statement runner, and what a caller's content protections resolve to for
 * one project. Shared with the `/api/v1/query` door's mount, which reads the
 * same four off {@link module:app-production}.
 */
export type ApiLangWatchQLRestCollaborators = Readonly<{
  featureFlags: () => FeatureFlagApi;
  projects: () => ProjectApi;
  langWatchQL: () => LangWatchQLService;
  protectionsFor: (input: {
    projectId: string;
    credential: RestCredentialPrincipal;
  }) => Promise<LangWatchQLProtections>;
}>;

/** Deep link back into the workbench: every chart in a response answers with the same page. */
const WORKBENCH_PATH = "/analytics/query";

/** `/api/v1/projects/:projectId/analytics/charts*`, bound to this process's graph. */
export function mountLangWatchQLRest(
  runtime: ApiRestRuntime,
  options: Readonly<{
    collaborators: ApiLangWatchQLRestCollaborators;
    dashboard: () => DashboardApi;
    publicBaseUrl: string | undefined;
  }>,
): MountableRestApp {
  const platformUrl = createPlatformUrlBuilder(options.publicBaseUrl);

  const app: SavedWorkbenchChartApi = {
    isWorkbenchEnabled: ({ projectId }) =>
      lwqlEnabled({
        featureFlags: options.collaborators.featureFlags(),
        projectId,
        projects: options.collaborators.projects(),
      }),
    listSavedWorkbenchCharts: (input) => options.dashboard().listSavedWorkbenchCharts(input),
    getSavedWorkbenchChart: (input) => options.dashboard().getSavedWorkbenchChart(input),
    createSavedWorkbenchChart: (input) => options.dashboard().createSavedWorkbenchChart(input),
    updateSavedWorkbenchChart: (input) => options.dashboard().updateSavedWorkbenchChart(input),
    deleteSavedWorkbenchChart: (input) => options.dashboard().deleteSavedWorkbenchChart(input),
    placeSavedWorkbenchChart: (input) => options.dashboard().placeSavedWorkbenchChart(input),
    unplaceSavedWorkbenchChart: async (input) => {
      await options.dashboard().unplaceSavedWorkbenchChart(input);
    },
  };

  return runtime.mount(savedWorkbenchChartRest.router(), () => app, {
    onError: canonicalErrors,
    facts: [
      bindRestMiddleware(savedWorkbenchChartUrl, (context) =>
        platformUrl({
          projectSlug: runtime.projectCredentialOf(context.req.raw).project.slug,
          path: WORKBENCH_PATH,
        }),
      ),
      bindRestMiddleware(langWatchQLCallerProtections, (context) => {
        const credential = runtime.projectCredentialOf(context.req.raw);

        return options.collaborators.protectionsFor({
          projectId: credential.project.id,
          credential: credentialPrincipalOfToken(credential),
        });
      }),
    ],
  });
}
