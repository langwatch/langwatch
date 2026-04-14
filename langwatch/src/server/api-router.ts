/**
 * Unified Hono API router that consolidates all API routes.
 *
 * This replaces:
 * - Next.js App Router API routes (src/app/api/.../route.ts with hono/vercel adapter)
 * - Next.js Pages Router API routes (src/pages/api/...ts)
 *
 * All routes are mounted under their original /api/* paths.
 */
import { Hono } from "hono";

// --- App Router Hono apps (already pure Hono) ---
import { app as agentsApp } from "../app/api/agents/[[...route]]/app";
import { app as analyticsApp } from "../app/api/analytics/[...route]/app";
import { app as copilotKitApp } from "../app/api/copilotkit/[[...route]]/app";
import { app as dashboardsApp } from "../app/api/dashboards/[[...route]]/app";
import { app as datasetApp } from "../app/api/dataset/[[...route]]/app";
import { app as evaluatorsApp } from "../app/api/evaluators/[[...route]]/app";
import { app as exportTracesApp } from "../app/api/export/traces/[[...route]]/app";
import { app as modelProvidersApp } from "../app/api/model-providers/[[...route]]/app";
import { app as promptsApp } from "../app/api/prompts/[[...route]]/app";
import { app as scenarioEventsApp } from "../app/api/scenario-events/[[...route]]/app";
import { app as scenariosApp } from "../app/api/scenarios/[[...route]]/app";
import { app as tracesApp } from "../app/api/traces/[[...route]]/app";

// --- Newly migrated App Router routes (were handle(app) or raw NextRequest) ---
import { app as datasetGenerateApp } from "./routes/dataset-generate";
import { app as evaluationsV3App } from "./routes/evaluations-v3";
import { app as healthChecksApp } from "./routes/health-checks";
import { app as otelApp } from "./routes/otel";
import { app as playgroundApp } from "./routes/playground";
import { app as scenarioGenerateApp } from "./routes/scenario-generate";
import { app as scimApp } from "./routes/scim";
import { app as webhooksApp } from "./routes/webhooks";
import { app as workflowsApp } from "./routes/workflows";

// --- Pages Router migrations (now pure Hono) ---
import { app as adminApp } from "./routes/admin";
import { app as annotationsApp } from "./routes/annotations";
import { app as authApp } from "./routes/auth";
import { app as collectorApp } from "./routes/collector";
import { app as cronApp } from "./routes/cron";
import { app as evaluationsLegacyApp } from "./routes/evaluations-legacy";
import { app as healthApp } from "./routes/health";
import { app as miscApp } from "./routes/misc";
import { app as sseApp } from "./routes/sse";
import { app as tracesLegacyApp } from "./routes/traces-legacy";
import { app as trpcApp } from "./routes/trpc";

/**
 * Creates the unified API Hono app.
 * Each sub-app already has its basePath set (e.g., "/api/traces"),
 * so we mount them all on the root.
 */
export function createApiRouter() {
  const api = new Hono();

  // Mount all Hono sub-apps. Each already has basePath like "/api/traces"
  // so we mount at "/" and they handle their own path matching.
  //
  // ORDERING MATTERS: More specific routes must come before catch-all routes
  // that share the same basePath. For example, /api/dataset/generate must be
  // mounted before /api/dataset/:slugOrId to avoid "generate" matching as a slug.

  // Routes with specific paths that must come before catch-all siblings
  api.route("/", datasetGenerateApp);    // POST /api/dataset/generate (before datasetApp's /:slugOrId)
  api.route("/", workflowsApp);          // POST /api/workflows/code-completion, /post_event
  api.route("/", healthChecksApp);       // GET  /api/health/collector, /evaluations, etc.

  // App Router Hono apps (pre-existing)
  api.route("/", agentsApp);
  api.route("/", analyticsApp);
  api.route("/", copilotKitApp);
  api.route("/", dashboardsApp);
  api.route("/", datasetApp);
  api.route("/", evaluatorsApp);
  api.route("/", exportTracesApp);
  api.route("/", modelProvidersApp);
  api.route("/", promptsApp);
  api.route("/", scenarioEventsApp);
  api.route("/", scenariosApp);
  api.route("/", tracesApp);

  // Newly migrated App Router routes
  api.route("/", evaluationsV3App);
  api.route("/", otelApp);
  api.route("/", playgroundApp);
  api.route("/", scenarioGenerateApp);
  api.route("/", scimApp);
  api.route("/", webhooksApp);

  // Pages Router migrations
  api.route("/", adminApp);
  api.route("/", annotationsApp);
  api.route("/", authApp);
  api.route("/", collectorApp);
  api.route("/", cronApp);
  api.route("/", evaluationsLegacyApp);
  api.route("/", healthApp);
  api.route("/", miscApp);
  api.route("/", sseApp);
  api.route("/", tracesLegacyApp);
  api.route("/", trpcApp);

  return api;
}
