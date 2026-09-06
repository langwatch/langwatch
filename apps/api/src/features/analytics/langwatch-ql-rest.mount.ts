/**
 * This process's composition of the packaged governed-SQL REST family
 * (`@langwatch/analytics-server`).
 */
import {
  createLangWatchQLRestApp,
  type LangWatchQLRestPorts,
  type SavedWorkbenchChartRestService,
} from "@langwatch/analytics-server";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import { type DashboardApp, SavedWorkbenchChartErrorsAdapter } from "@langwatch/dashboard-server";

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
  dashboard: () => DashboardApp;
  publicBaseUrl: string | undefined;
}): MountableRestApp {
  return createLangWatchQLRestApp({
    security: options.security,
    ports: {
      ...options.collaborators,
      charts: () => options.dashboard() as unknown as SavedWorkbenchChartRestService,
      platformUrl: createPlatformUrlBuilder(options.publicBaseUrl),
      mapSavedChartError: (error) =>
        SavedWorkbenchChartErrorsAdapter.mapDashboardSavedWorkbenchChartError(error),
    },
  });
}
