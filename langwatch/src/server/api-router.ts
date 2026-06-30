/**
 * Unified Hono API router — all /api/* routes mounted here.
 * Each sub-app sets its own basePath (e.g. "/api/traces").
 */
import { type Context, Hono } from "hono";

import { createServiceApp, publicEndpoint } from "~/server/api/security";
import { app as adminApp } from "../../ee/admin/routes/admin";
import { app as agentsApp } from "../app/api/agents/[[...route]]/app";
import { app as analyticsApp } from "../app/api/analytics/[...route]/app";
import { app as apiKeysApp } from "../app/api/api-keys/[[...route]]/app";
import { app as copilotKitApp } from "../app/api/copilotkit/[[...route]]/app";
import { app as dashboardsApp } from "../app/api/dashboards/[[...route]]/app";
import { app as datasetApp } from "../app/api/dataset/[[...route]]/app";
import { app as evaluatorsApp } from "../app/api/evaluators/[[...route]]/app";
import { app as eventsApp } from "../app/api/events/[[...route]]/app";
import { app as experimentsApp } from "../app/api/experiments/[[...route]]/app";
import { app as exportTracesApp } from "../app/api/export/traces/[[...route]]/app";
import { app as filesApp } from "../app/api/files/[[...route]]/app";
import { app as gatewayPlatformApp } from "../app/api/gateway-platform/[[...route]]/app";
import { app as governanceApp } from "../app/api/governance/[[...route]]/app";
import { app as graphsApp } from "../app/api/graphs/[[...route]]/app";
import { app as meApp } from "../app/api/me/[[...route]]/app";
import { app as modelDefaultsApp } from "../app/api/model-defaults/[[...route]]/app";
import { app as modelProvidersApp } from "../app/api/model-providers/[[...route]]/app";
import { app as monitorsApp } from "../app/api/monitors/[[...route]]/app";
import { app as projectsApp } from "../app/api/projects/[[...route]]/app";
import { app as promptsApp } from "../app/api/prompts/[[...route]]/app";
import { app as scenarioEventsApp } from "../app/api/scenario-events/[[...route]]/app";
import { app as scenariosApp } from "../app/api/scenarios/[[...route]]/app";
import { app as secretsApp } from "../app/api/secrets/[[...route]]/app";
import { app as simulationRunsApp } from "../app/api/simulation-runs/[[...route]]/app";
import { app as suitesApp } from "../app/api/suites/[[...route]]/app";
import { app as teamsApp } from "../app/api/teams/[[...route]]/app";
import { app as tracesApp } from "../app/api/traces/[[...route]]/app";
import { app as triggersApp } from "../app/api/triggers/[[...route]]/app";
import { app as workflowsCrudApp } from "../app/api/workflows/[[...route]]/app";
import { app as annotationsApp } from "./routes/annotations";
import { app as authApp } from "./routes/auth";
import { app as authCliApp } from "./routes/auth-cli";
import { app as collectorApp } from "./routes/collector";
import { app as cronApp } from "./routes/cron";
import { app as datasetGenerateApp } from "./routes/dataset-generate";
import { app as evaluationsLegacyApp } from "./routes/evaluations-legacy";
import {
  app as experimentsV3App,
  legacyAliasApp as experimentsV3LegacyAliasApp,
} from "./routes/experiments-v3";
import { app as gatewayInternalApp } from "./routes/gateway-internal";
import { app as healthApp } from "./routes/health";
import { app as healthChecksApp } from "./routes/health-checks";
import { app as ingestionRoutesApp } from "./routes/ingest/ingestionRoutes";
import { app as miscApp } from "./routes/misc";
import { app as opsApp } from "./routes/ops";
import { app as otelApp } from "./routes/otel";
import { app as playgroundApp } from "./routes/playground";
import { app as scenarioGenerateApp } from "./routes/scenario-generate";
import { app as scimApp } from "./routes/scim";
import { app as sseApp } from "./routes/sse";
import { app as tracesLegacyApp } from "./routes/traces-legacy";
import { app as trpcApp } from "./routes/trpc";
import { app as webhooksApp } from "./routes/webhooks";
import { app as workflowsApp } from "./routes/workflows";

export function createApiRouter() {
  const api = new Hono();

  // Legacy OAuth callback rewrites — customer IdPs registered with old URLs.
  // These only rewrite the path and re-dispatch to /api/auth/oauth2/callback/*
  // (handled by authApp), so they carry a public policy and are registered
  // through the builder rather than raw Hono.
  const legacyOAuthCallbacks = createServiceApp({
    basePath: "/api/auth/callback",
  });
  const rewriteCallback = (provider: string) => (c: Context) => {
    const url = new URL(c.req.url);
    url.pathname = `/api/auth/oauth2/callback/${provider}`;
    return api.fetch(new Request(url.toString(), c.req.raw));
  };
  legacyOAuthCallbacks
    .access(
      publicEndpoint(
        "legacy IdP callback URL; rewrites to /api/auth/oauth2/callback/* and re-dispatches",
      ),
    )
    .all("/auth0", rewriteCallback("auth0"));
  legacyOAuthCallbacks
    .access(
      publicEndpoint(
        "legacy IdP callback URL; rewrites to /api/auth/oauth2/callback/* and re-dispatches",
      ),
    )
    .all("/okta", rewriteCallback("okta"));
  api.route("/", legacyOAuthCallbacks.hono);

  // ORDERING: specific paths before catch-all siblings with same basePath
  api.route("/", datasetGenerateApp); // /api/dataset/generate (before datasetApp's /:slugOrId)
  api.route("/", workflowsApp); // /api/workflows/code-completion, /post_event
  api.route("/", healthChecksApp); // /api/health/collector, /evaluations, etc.

  api.route("/", agentsApp);
  api.route("/", analyticsApp);
  api.route("/", copilotKitApp);
  api.route("/", dashboardsApp);
  api.route("/", datasetApp);
  api.route("/", evaluatorsApp);
  api.route("/", eventsApp);
  // experimentsV3App owns the session-authenticated execute/abort endpoints and
  // the API-key-authenticated run/runs endpoints; experimentsApp owns the
  // project-API-key list endpoint (GET /api/experiments). Both live under
  // /api/experiments. v3 mounts first so its specific handlers (e.g. POST
  // /api/experiments/execute, a session-cookie request) match before any
  // sibling route resolution. experimentsApp authenticates per-route via the
  // SecuredApp builder (no namespace-wide guard), so this ordering is
  // belt-and-suspenders; the experiments-route-auth regression test pins it.
  api.route("/", experimentsV3App);
  api.route("/", experimentsV3LegacyAliasApp); // /api/evaluations/v3/... → /api/experiments/...
  api.route("/", experimentsApp);
  api.route("/", filesApp);
  api.route("/", exportTracesApp);
  api.route("/", gatewayPlatformApp);
  api.route("/", governanceApp);
  api.route("/", graphsApp);
  api.route("/", meApp); // /api/me/usage — personal spend/usage
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
  api.route("/", workflowsCrudApp); // CRUD — complements workflowsApp (code-completion, post_event)

  api.route("/", gatewayInternalApp);
  api.route("/", otelApp);
  api.route("/", playgroundApp);
  api.route("/", scenarioGenerateApp);
  api.route("/", scimApp);
  api.route("/", webhooksApp);

  api.route("/", adminApp);
  api.route("/", annotationsApp);
  // ORDERING: authCliApp MUST be registered BEFORE authApp.
  // authApp owns the BetterAuth catch-all (`/auth/*`), which would
  // otherwise swallow `/auth/cli/*` and return 404 from BetterAuth.
  // Register the more-specific basePath first so Hono routes match it.
  api.route("/", authCliApp); // /api/auth/cli/* — RFC 8628 device-flow for CLI
  api.route("/", authApp);
  api.route("/", collectorApp);
  api.route("/", ingestionRoutesApp); // /api/ingest/* — Activity Monitor receivers
  api.route("/", cronApp);
  api.route("/", evaluationsLegacyApp);
  api.route("/", healthApp);
  api.route("/", miscApp);
  api.route("/", opsApp);
  api.route("/", sseApp);
  api.route("/", tracesLegacyApp);
  api.route("/", trpcApp);

  return api;
}
