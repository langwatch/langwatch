/**
 * Unified Hono API router — all /api/* routes mounted here.
 * Each sub-app sets its own basePath (e.g. "/api/traces").
 */
import { Hono } from "hono";

import { app as agentsApp } from "../app/api/agents/[[...route]]/app";
import { app as analyticsApp } from "../app/api/analytics/[...route]/app";
import { app as copilotKitApp } from "../app/api/copilotkit/[[...route]]/app";
import { app as dashboardsApp } from "../app/api/dashboards/[[...route]]/app";
import { app as datasetApp } from "../app/api/dataset/[[...route]]/app";
import { app as evaluatorsApp } from "../app/api/evaluators/[[...route]]/app";
import { app as exportTracesApp } from "../app/api/export/traces/[[...route]]/app";
import { app as graphsApp } from "../app/api/graphs/[[...route]]/app";
import { app as modelProvidersApp } from "../app/api/model-providers/[[...route]]/app";
import { app as monitorsApp } from "../app/api/monitors/[[...route]]/app";
import { app as promptsApp } from "../app/api/prompts/[[...route]]/app";
import { app as scenarioEventsApp } from "../app/api/scenario-events/[[...route]]/app";
import { app as scenariosApp } from "../app/api/scenarios/[[...route]]/app";
import { app as secretsApp } from "../app/api/secrets/[[...route]]/app";
import { app as simulationRunsApp } from "../app/api/simulation-runs/[[...route]]/app";
import { app as suitesApp } from "../app/api/suites/[[...route]]/app";
import { app as tracesApp } from "../app/api/traces/[[...route]]/app";
import { app as triggersApp } from "../app/api/triggers/[[...route]]/app";
import { app as workflowsCrudApp } from "../app/api/workflows/[[...route]]/app";

import { app as datasetGenerateApp } from "./routes/dataset-generate";
import { app as evaluationsV3App } from "./routes/evaluations-v3";
import { app as healthChecksApp } from "./routes/health-checks";
import { app as otelApp } from "./routes/otel";
import { app as playgroundApp } from "./routes/playground";
import { app as scenarioGenerateApp } from "./routes/scenario-generate";
import { app as scimApp } from "./routes/scim";
import { app as webhooksApp } from "./routes/webhooks";
import { app as workflowsApp } from "./routes/workflows";

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

export function createApiRouter() {
  const api = new Hono();

  // Legacy OAuth callback rewrites — customer IdPs registered with old URLs
  api.all("/api/auth/callback/auth0", (c) => {
    const url = new URL(c.req.url);
    url.pathname = "/api/auth/oauth2/callback/auth0";
    return api.fetch(new Request(url.toString(), c.req.raw));
  });
  api.all("/api/auth/callback/okta", (c) => {
    const url = new URL(c.req.url);
    url.pathname = "/api/auth/oauth2/callback/okta";
    return api.fetch(new Request(url.toString(), c.req.raw));
  });

  // ORDERING: specific paths before catch-all siblings with same basePath
  api.route("/", datasetGenerateApp);    // /api/dataset/generate (before datasetApp's /:slugOrId)
  api.route("/", workflowsApp);          // /api/workflows/code-completion, /post_event
  api.route("/", healthChecksApp);       // /api/health/collector, /evaluations, etc.

  api.route("/", agentsApp);
  api.route("/", analyticsApp);
  api.route("/", copilotKitApp);
  api.route("/", dashboardsApp);
  api.route("/", datasetApp);
  api.route("/", evaluatorsApp);
  api.route("/", exportTracesApp);
  api.route("/", graphsApp);
  api.route("/", modelProvidersApp);
  api.route("/", monitorsApp);
  api.route("/", promptsApp);
  api.route("/", scenarioEventsApp);
  api.route("/", scenariosApp);
  api.route("/", secretsApp);
  api.route("/", simulationRunsApp);
  api.route("/", suitesApp);
  api.route("/", tracesApp);
  api.route("/", triggersApp);
  api.route("/", workflowsCrudApp);      // CRUD — complements workflowsApp (code-completion, post_event)

  api.route("/", evaluationsV3App);
  api.route("/", otelApp);
  api.route("/", playgroundApp);
  api.route("/", scenarioGenerateApp);
  api.route("/", scimApp);
  api.route("/", webhooksApp);

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
