/**
 * Governed analytics SQL — the mounted app.
 *
 * `basePath` is `/api/v1/projects` because issue #6480 names the endpoints
 * under it; the directory this file sits in is only where the repo keeps route
 * modules, and carries no routing meaning. The routes themselves are in
 * `./app.v1.ts`.
 *
 * Project-scoped rather than service-scoped: these endpoints authenticate with
 * a customer's API key and must resolve a project and its RBAC, which is what
 * `createProjectApp` wires. A `createServiceApp` here would authenticate with a
 * shared internal secret and reach no project at all.
 */

import { createProjectApp } from "~/server/api/security";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { registerGovernedSqlRoutes } from "./app.v1";

patchZodOpenapi();

const secured = createProjectApp({
  basePath: "/api/v1/projects",
  // A new route family, so it publishes the canonical error envelope from the
  // start rather than joining the legacy families a consumer already parses.
  errorEnvelope: "canonical",
});

registerGovernedSqlRoutes(secured);

export const app = secured.hono;
