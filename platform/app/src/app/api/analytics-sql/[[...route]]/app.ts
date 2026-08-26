/**
 * Analytics SQL — the mounted app.
 *
 * `basePath` is `/api/v1/projects` because issue #6480 named the original
 * LangWatchQL REST endpoints under it; the directory this file sits in is
 * only where the repo keeps route modules, and carries no routing meaning.
 * The raw-LWQL routes those endpoints served (query and schema) were removed
 * by issue #7565 — the JSON-RPC domain endpoint `POST /api/v1/query`
 * supersedes them. What remains here is `./app.charts.v1.ts`: the saved
 * workbench chart routes, which publish their refusals through the same
 * canonical error handler this app still wires.
 *
 * Project-scoped rather than service-scoped: these endpoints authenticate with
 * a customer's API key and must resolve a project and its RBAC, which is what
 * `createProjectApp` wires. A `createServiceApp` here would authenticate with a
 * shared internal secret and reach no project at all.
 */

import { createProjectApp } from "~/server/api/security";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { registerSavedWorkbenchChartRoutes } from "./app.charts.v1";

patchZodOpenapi();

const secured = createProjectApp({
  basePath: "/api/v1/projects",
  // A new route family, so it publishes the canonical error envelope from the
  // start rather than joining the legacy families a consumer already parses.
  errorEnvelope: "canonical",
});

registerSavedWorkbenchChartRoutes(secured);

export const app = secured.hono;
