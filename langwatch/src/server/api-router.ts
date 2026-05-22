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
import { app as experimentsApp } from "../app/api/experiments/[[...route]]/app";
import { app as exportTracesApp } from "../app/api/export/traces/[[...route]]/app";
import { app as gatewayPlatformApp } from "../app/api/gateway-platform/[[...route]]/app";
import { app as graphsApp } from "../app/api/graphs/[[...route]]/app";
import { app as modelDefaultsApp } from "../app/api/model-defaults/[[...route]]/app";
import { app as modelProvidersApp } from "../app/api/model-providers/[[...route]]/app";
import { app as monitorsApp } from "../app/api/monitors/[[...route]]/app";
import { app as apiKeysApp } from "../app/api/api-keys/[[...route]]/app";
import { app as projectsApp } from "../app/api/projects/[[...route]]/app";
import { app as promptsApp } from "../app/api/prompts/[[...route]]/app";
import { app as filesApp } from "../app/api/files/[[...route]]/app";
import { app as scenarioEventsApp } from "../app/api/scenario-events/[[...route]]/app";
import { app as scenariosApp } from "../app/api/scenarios/[[...route]]/app";
import { app as secretsApp } from "../app/api/secrets/[[...route]]/app";
import { app as simulationRunsApp } from "../app/api/simulation-runs/[[...route]]/app";
import { app as suitesApp } from "../app/api/suites/[[...route]]/app";
import { app as teamsApp } from "../app/api/teams/[[...route]]/app";
import { app as tracesApp } from "../app/api/traces/[[...route]]/app";
import { app as triggersApp } from "../app/api/triggers/[[...route]]/app";
import { app as workflowsCrudApp } from "../app/api/workflows/[[...route]]/app";

import { app as datasetGenerateApp } from "./routes/dataset-generate";
import { app as experimentsV3App, legacyAliasApp as experimentsV3LegacyAliasApp } from "./routes/experiments-v3";
import { app as gatewayInternalApp } from "./routes/gateway-internal";
import { app as healthChecksApp } from "./routes/health-checks";
import { app as otelApp } from "./routes/otel";
import { app as langyApp } from "./routes/langy";
import { app as playgroundApp } from "./routes/playground";
import { app as scenarioGenerateApp } from "./routes/scenario-generate";
import { app as scimApp } from "./routes/scim";
import { app as webhooksApp } from "./routes/webhooks";
import { app as workflowsApp } from "./routes/workflows";

import { app as adminApp } from "../../ee/admin/routes/admin";
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
  // experimentsV3App owns the session-authenticated execute/abort endpoints and
  // the API-key-authenticated run/runs endpoints. It must mount before
  // experimentsApp, whose project-API-key auth middleware spans the whole
  // /api/experiments/* namespace. Mounted first, that middleware would run on
  // POST /api/experiments/execute (a session-cookie request that carries no
  // API key) and reject it before the session is ever checked. Mounting v3
  // first lets its own handlers match and respond, short-circuiting the guard.
  api.route("/", experimentsV3App);
  api.route("/", experimentsV3LegacyAliasApp);  // /api/evaluations/v3/... → /api/experiments/...
  api.route("/", experimentsApp);
  api.route("/", filesApp);
  api.route("/", exportTracesApp);
  api.route("/", gatewayPlatformApp);
  api.route("/", graphsApp);
  api.route("/", modelDefaultsApp);
  api.route("/", modelProvidersApp);
  api.route("/", monitorsApp);
  api.route("/", apiKeysApp);
  api.route("/", projectsApp);
  api.route("/", promptsApp);
  api.route("/", scenarioEventsApp);
  api.route("/", scenariosApp);
  api.route("/", secretsApp);
  api.route("/", simulationRunsApp);
  api.route("/", suitesApp);
  api.route("/", teamsApp);
  api.route("/", tracesApp);
  api.route("/", triggersApp);
  api.route("/", workflowsCrudApp);      // CRUD — complements workflowsApp (code-completion, post_event)

  api.route("/", gatewayInternalApp);
  api.route("/", otelApp);
  api.route("/", playgroundApp);
  api.route("/", langyApp);
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
