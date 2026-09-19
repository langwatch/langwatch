import type { HealthRoute } from "@langwatch/process-server";

/**
 * Parity with platform/app's routes/health.ts: operational infrastructure
 * (load balancers, k8s probes) points at "/api/health", not the framework's
 * own "/healthz" door. Same shape, same status: no body, 204.
 */
export const apiHealthRoute: HealthRoute = {
  path: "/api/health",
  handle: (_request, response) => {
    response.writeHead(204).end();
  },
};
