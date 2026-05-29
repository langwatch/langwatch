/**
 * Hono route for health check.
 *
 * Replaces src/pages/api/health.ts
 */
import {
  createServiceApp,
  publicEndpoint,
} from "~/server/api/security";

const secured = createServiceApp({ basePath: "/api" });

secured.access(publicEndpoint("liveness/readiness probe")).get("/health", (c) => {
  return c.body(null, 204);
});

secured.access(publicEndpoint("liveness/readiness probe")).head("/health", (c) => {
  return c.body(null, 204);
});

export const app = secured.hono;
