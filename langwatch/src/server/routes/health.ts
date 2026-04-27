/**
 * Hono route for health check.
 *
 * Replaces src/pages/api/health.ts
 */
import { Hono } from "hono";

export const app = new Hono().basePath("/api");

app.all("/health", (c) => {
  return c.body(null, 204);
});
