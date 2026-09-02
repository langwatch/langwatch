/**
 * LangWatchQL analytics SQL — the mounted family.
 *
 * `basePath` is `/api/v1/projects` because issue #6480 names the endpoints
 * under it. The routes themselves are in `./langwatch-ql-query.api` (query and
 * schema) and `./saved-workbench-chart.api` (saved charts) — one family,
 * because both are behind the same experimental switch and both publish their
 * refusals through the same error handler.
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
 * @see specs/analytics/lwql-api.feature
 * @see specs/analytics/lwql-saved-charts.feature
 */
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";

import { registerLangWatchQLRoutes } from "./langwatch-ql-query.api";
import { registerSavedWorkbenchChartRoutes } from "./saved-workbench-chart.api";
import type { LangWatchQLRestPorts } from "./langwatch-ql-route-guards";

export type { LangWatchQLRestPorts } from "./langwatch-ql-route-guards";

/** `/api/v1/projects/:projectId/analytics/*`, bound to one process's graph. */
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

  registerLangWatchQLRoutes(secured, options.ports);
  registerSavedWorkbenchChartRoutes(secured, options.ports);

  return secured.hono;
}
