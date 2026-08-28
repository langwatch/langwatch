/**
 * Hono route for health check.
 *
 * Replaces src/pages/api/health.ts
 */
import { createServiceApp } from "~/server/api/security";
import { publicEndpoint } from "@langwatch/platform-api/app-rest";

const secured = createServiceApp({ basePath: "/api" });

secured.access(publicEndpoint("liveness/readiness probe")).get("/health", (c) => {
  return c.body(null, 204);
});

secured.access(publicEndpoint("liveness/readiness probe")).head("/health", (c) => {
  return c.body(null, 204);
});

export const app = secured.hono;
