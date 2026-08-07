/**
 * Governed analytics SQL — the mounted app.
 *
 * `basePath` is `/api/v1/projects` because issue #6480 names the endpoints
 * under it; the directory this file sits in is only where the repo keeps route
 * modules, and carries no routing meaning. The routes themselves are in
 * `./app.v1.ts` (query and schema) and `./app.charts.v1.ts` (saved charts) —
 * one family, because both are behind the same experimental switch and both
 * publish their refusals through the same error handler.
 *
 * Project-scoped rather than service-scoped: these endpoints authenticate with
 * a customer's API key and must resolve a project and its RBAC, which is what
 * `createProjectApp` wires. A `createServiceApp` here would authenticate with a
 * shared internal secret and reach no project at all.
 */

import { createProjectApp } from "~/server/api/security";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { registerSavedWorkbenchChartRoutes } from "./app.charts.v1";
import { registerGovernedSqlRoutes } from "./app.v1";

patchZodOpenapi();

const secured = createProjectApp({
  basePath: "/api/v1/projects",
});

registerGovernedSqlRoutes(secured);
registerSavedWorkbenchChartRoutes(secured);

export const app = secured.hono;
