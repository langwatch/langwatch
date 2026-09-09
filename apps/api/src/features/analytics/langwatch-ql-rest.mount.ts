/**
 * This process's composition of the packaged governed-SQL REST family
 * (`@langwatch/analytics-server`).
 */
import {
  createLangWatchQLRestApp,
  type LangWatchQLRestPorts,
} from "@langwatch/analytics-server/api-rest/langwatch-ql";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import type { DashboardApi } from "@langwatch/dashboard-contract";

import { createPlatformUrlBuilder } from "../../app/api-rest-ports.ts";

/** The three collaborators the analytics half publishes for this family. */
export type ApiLangWatchQLRestCollaborators = Pick<
  LangWatchQLRestPorts,
  "featureFlags" | "projects" | "langWatchQL" | "protectionsFor"
>;

/** `/api/v1/projects/:projectId/analytics/*`, bound to this process's graph. */
export function mountLangWatchQLRest(options: {
  security: AppRestSecurity;
  collaborators: ApiLangWatchQLRestCollaborators;
  dashboard: () => DashboardApi;
  publicBaseUrl: string | undefined;
}): MountableRestApp {
  return createLangWatchQLRestApp({
    security: options.security,
    ports: {
      ...options.collaborators,
      charts: () => {
        const dashboard = options.dashboard();

        return {
          listSavedWorkbenchCharts: (input) => dashboard.listSavedWorkbenchCharts(input),
          getSavedWorkbenchChart: (input) => dashboard.getSavedWorkbenchChart(input),
          createSavedWorkbenchChart: (input) => dashboard.createSavedWorkbenchChart(input),
          updateSavedWorkbenchChart: (input) => dashboard.updateSavedWorkbenchChart(input),
          deleteSavedWorkbenchChart: (input) => dashboard.deleteSavedWorkbenchChart(input),
          placeSavedWorkbenchChart: (input) => dashboard.placeSavedWorkbenchChart(input),
          // The family publishes nothing on an unplace; the dashboard answers
          // the detached chart, which this door has never returned.
          unplaceSavedWorkbenchChart: async (input) => {
            await dashboard.unplaceSavedWorkbenchChart(input);
          },
        };
      },
      platformUrl: createPlatformUrlBuilder(options.publicBaseUrl),
      // The dashboard contract's own refusals already carry the codes and
      // statuses this family publishes, so the mapper only re-throws.
      mapSavedChartError: (error) => {
        throw error;
      },
    },
  });
}
