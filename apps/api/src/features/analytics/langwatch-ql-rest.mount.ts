/**
 * This process's composition of the packaged governed-SQL REST family
 * (`@langwatch/analytics-server`).
 *
 * Nine endpoints under `/api/v1/projects/:projectId/analytics/*`: the
 * LangWatchQL query and schema pair, and the seven saved-workbench-chart
 * operations beside them. The routes, their guards, their wire schemas and
 * their OpenAPI declarations live in the feature package. What lives here is
 * the graph they dispatch through, and every entry is TAKEN from a half this
 * process already composed rather than built a second time — the governed-SQL
 * runner most of all, because two of it would let the workbench refuse a
 * statement an API key can still run.
 *
 * The saved-chart half arrives as a port over `DashboardApp`: a saved chart is
 * a dashboard resource with a dashboard lifecycle, and a feature server
 * package may not reach into another feature's server package.
 */
import {
  createLangWatchQLRestApp,
  type LangWatchQLRestPorts,
  type SavedWorkbenchChartRestService,
} from "@langwatch/analytics-server";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import {
  mapDashboardSavedWorkbenchChartError,
  type DashboardApp,
} from "@langwatch/dashboard-server";

import { createPlatformUrlBuilder } from "../../app/api-rest-ports";

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
      mapSavedChartError: (error) => mapDashboardSavedWorkbenchChartError(error),
    },
  });
}
