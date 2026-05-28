import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createProjectApp } from "~/server/api/security";
import { registerAnalyticsRoutes } from "./app.v1";

patchZodOpenapi();

// Project-scoped secured app. Every route must declare an access policy via
// `.access(...)` before it can be registered — the type-safe replacement for
// the old optional `requirePermission` middleware.
const secured = createProjectApp({
  basePath: "/api/analytics",
  family: "analytics",
});

registerAnalyticsRoutes(secured);

export const app = secured.hono;
