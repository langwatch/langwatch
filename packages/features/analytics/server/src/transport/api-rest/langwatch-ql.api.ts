/**
 * Saved workbench charts — the mounted family.
 *
 * `basePath` is `/api/v1/projects` because issue #6480 names the endpoints
 * under it. The routes themselves are in `./saved-workbench-chart.api`.
 *
 * Raw LangWatchQL used to be served here too, at
 * `.../analytics/query/clickhouse` and `.../analytics/schema`. Both were
 * removed (issue #7565) in favour of the one door at `/api/v1/query`; this
 * family now serves saved charts only.
 *
 * Project-scoped rather than service-scoped: these endpoints authenticate with
 * a customer's API key and must resolve a project and its RBAC, which is what
 * `createProjectApp` wires. A service app here would authenticate with a
 * shared internal secret and reach no project at all.
 *
 * Every collaborator arrives on {@link LangWatchQLRestPorts} rather than being
 * read off a process-wide application container, which is what lets this
 * family be mounted by a second process — or by a test — against a different
 * graph without touching a route.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";

import { registerSavedWorkbenchChartRoutes } from "./saved-workbench-chart.api";
import type { LangWatchQLRestPorts } from "./langwatch-ql-route-guards";

export type { LangWatchQLRestPorts } from "./langwatch-ql-route-guards";

/** `/api/v1/projects/:projectId/analytics/charts/*`, bound to one process's graph. */
export function createLangWatchQLRestApp(options: {
  security: AppRestSecurity;
  ports: LangWatchQLRestPorts;
}): MountableRestApp {
  const secured = options.security.createProjectApp({
    basePath: "/api/v1/projects",
    // A new route family, so it publishes the canonical error envelope from
    // the start rather than joining the legacy families a consumer already
    // parses.
    errorEnvelope: "canonical",
  });

  registerSavedWorkbenchChartRoutes(secured, options.ports);

  return secured.hono;
}
