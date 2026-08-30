/**
 * Unified Hono API router — all /api/* routes mounted here.
 * Each sub-app sets its own basePath (e.g. "/api/traces").
 */

import { app as scimApp } from "@ee/scim/routes";
import { app as webhooksApp } from "@ee/scim/webhooks";
import { Hono } from "hono";
import { app as adminApp } from "../../ee/admin/routes/admin";
import { app as agentCacheApp } from "../app/api/agent-cache/[[...route]]/app";
import { app as agentsApp } from "../app/api/agents/[[...route]]/app";
import { app as analyticsApp } from "../app/api/analytics/[...route]/app";
import { app as analyticsSqlApp } from "../app/api/analytics-sql/[[...route]]/app";
import { app as apiKeysApp } from "../app/api/api-keys/[[...route]]/app";
import { app as codingAgentApp } from "../app/api/coding-agent/[[...route]]/app";
import { app as codingAgentV1App } from "../app/api/coding-agent/[[...route]]/app.v1";
import { app as copilotKitApp } from "../app/api/copilotkit/[[...route]]/app";
import { app as dashboardsApp } from "../app/api/dashboards/[[...route]]/app";
import { app as datasetApp } from "../app/api/dataset/[[...route]]/app";
import { app as evaluatorsApp } from "../app/api/evaluators/[[...route]]/app";
import { app as eventsApp } from "../app/api/events/[[...route]]/app";
import { app as experimentsApp } from "../app/api/experiments/[[...route]]/app";
import { app as exportScenarioRunsApp } from "../app/api/export/scenario-runs/[[...route]]/app";
import { app as exportTracesApp } from "../app/api/export/traces/[[...route]]/app";
import { app as filesApp } from "../app/api/files/[[...route]]/app";
import { app as gatewayPlatformApp } from "../app/api/gateway-platform/[[...route]]/app";
import { app as gatewaySpendApp } from "../app/api/gateway-spend/[[...route]]/app";
import { app as governanceApp } from "../app/api/governance/[[...route]]/app";
import { app as graphsApp } from "../app/api/graphs/[[...route]]/app";
import { app as groupsApp } from "../app/api/groups/[[...route]]/app";
import { app as meApp } from "../app/api/me/[[...route]]/app";
import { app as modelDefaultsApp } from "../app/api/model-defaults/[[...route]]/app";
import { app as modelProvidersApp } from "../app/api/model-providers/[[...route]]/app";
import { app as monitorsApp } from "../app/api/monitors/[[...route]]/app";
import { app as organizationApp } from "../app/api/organization/[[...route]]/app";
import { app as organizationsApp } from "../app/api/organizations/[[...route]]/app";
import { app as projectsApp } from "../app/api/projects/[[...route]]/app";
import { app as promptsApp } from "../app/api/prompts/[[...route]]/app";
import { app as roleBindingsApp } from "../app/api/role-bindings/[[...route]]/app";
import { app as rolesApp } from "../app/api/roles/[[...route]]/app";
import { app as runPlansApp } from "../app/api/run-plans/[[...route]]/app";
import { app as scenarioEventsApp } from "../app/api/scenario-events/[[...route]]/app";
import { app as scenariosApp } from "../app/api/scenarios/[[...route]]/app";
import { app as scimTokensApp } from "../app/api/scim-tokens/[[...route]]/app";
import { app as secretsApp } from "../app/api/secrets/[[...route]]/app";
import { app as simulationRunsApp } from "../app/api/simulation-runs/[[...route]]/app";
import { app as suitesApp } from "../app/api/suites/[[...route]]/app";
import { app as teamsApp } from "../app/api/teams/[[...route]]/app";
import { app as testSuitesApp } from "../app/api/test-suites/[[...route]]/app";
import { app as tracesApp } from "../app/api/traces/[[...route]]/app";
import { app as triggersApp } from "../app/api/triggers/[[...route]]/app";
import { app as userAvatarApp } from "../app/api/user-avatar/[[...route]]/app";
import { app as webhookPlatformApp } from "../app/api/webhooks/[[...route]]/app";
import { app as workflowsCrudApp } from "../app/api/workflows/[[...route]]/app";
import { app as annotationsApp } from "./routes/annotations";
import { app as apiDiscoveryApp } from "./routes/api-discovery";
import { app as authApp } from "./routes/auth";
import { app as authCliApp } from "./routes/auth-cli";
import { app as bugReportsApp } from "./routes/bug-reports";
import { app as collectorApp } from "./routes/collector";
import { app as cronApp } from "./routes/cron";
import { app as datasetGenerateApp } from "./routes/dataset-generate";
import { app as elevenLabsApp } from "./routes/elevenlabs";
import { app as evaluationsLegacyApp } from "./routes/evaluations-legacy";
import {
  app as experimentsV3App,
  legacyAliasApp as experimentsV3LegacyAliasApp,
} from "./routes/experiments-v3";
import { app as gatewayInternalApp } from "./routes/gateway-internal";
import { app as gatewayOpenApiApp } from "./routes/gateway-openapi";
import { app as githubApp } from "./routes/github";
import { app as healthApp } from "./routes/health";
import { app as healthChecksApp } from "./routes/health-checks";
import { app as ingestionRoutesApp } from "./routes/ingest/ingestionRoutes";
import { app as langyApiApp } from "./routes/langy-api";
import { app as langyInternalApp } from "./routes/langy-internal";
import { app as langyRelayApp } from "./routes/langy-relay";
import { app as langyUiActionsApp } from "./routes/langy-ui-actions";
import { app as miscApp } from "./routes/misc";
import { app as opsApp } from "./routes/ops";
import { app as otelApp } from "./routes/otel";
import { app as otelPathAliasApp } from "./routes/otel-path-aliases";
import { app as playgroundApp } from "./routes/playground";
import { app as rootDiscoveryApp } from "./routes/root-discovery";
import { app as rumApp } from "./routes/rum";
import { app as scenarioGenerateApp } from "./routes/scenario-generate";
import { app as sseApp } from "./routes/sse";
import { app as tracesLegacyApp } from "./routes/traces-legacy";
import { app as trpcApp } from "./routes/trpc";
import { app as unsubscribeApp } from "./routes/unsubscribe";
import { app as workflowsApp } from "./routes/workflows";

export function createApiRouter() {
  const api = new Hono();

  // The legacy IdP callback rewrite lived here until better-auth 1.7. It took
  // `/api/auth/callback/<provider>` — the URL customer IdPs were registered
  // with — and re-dispatched it to the genericOAuth plugin's own
  // `/api/auth/oauth2/callback/<provider>`, because that was a second, more
  // specific code path and landing on the core social callback instead was
  // "a code path nobody chose".
  //
  // 1.7 removed the plugin's endpoints entirely: generic-oauth providers are
  // registered as first-class social providers now, so the CORE callback is
  // the only one there is — and it is mounted at exactly the path the rewrite
  // was rewriting away from. Keeping it would rewrite a working URL to a 404,
  // which is the whole of enterprise SSO. The catch-all serves it correctly,
  // so the right move is to stop intercepting it.
  //
  // `LEGACY_CALLBACK_PROVIDER_IDS` still pins each provider's `redirectURI`
  // (ee/sso/providers.ts) — the URL is unchanged, only who answers it.

  // ORDERING: specific paths before catch-all siblings with same basePath
  api.route("/", datasetGenerateApp); // /api/dataset/generate (before datasetApp's /:slugOrId)
  api.route("/", workflowsApp); // /api/workflows/code-completion, /post_event
  api.route("/", healthChecksApp); // /api/health/collector, /evaluations, etc.

  api.route("/", agentsApp);
  api.route("/", analyticsApp);
  api.route("/", analyticsSqlApp); // /api/v1/projects/:projectId/analytics/* — governed SQL
  api.route("/", copilotKitApp);
  api.route("/", codingAgentApp);
  api.route("/", codingAgentV1App); // /api/v1/coding-agent/* — organization-key door
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
  api.route("/", exportScenarioRunsApp);
  // ORDERING: the unauthenticated spec document shares the /api/gateway/v1
  // namespace with the credentialed resource routes, so it is mounted first
  // and cannot be shadowed by a sibling that later grows a parameterised
  // segment at the root of that namespace.
  api.route("/", gatewayOpenApiApp); // /api/gateway/v1/openapi.json
  // The same document at the two locations a caller tries first, plus the RPC
  // catalogue and /llms.txt. Two apps because the route-coverage gate only
  // reads files declaring an `/api` basePath — see api-discovery.ts. The
  // root-level pair only arrives here at all because start.ts consults
  // `isRootDiscoveryPath`; without that they meet the SPA fallback.
  api.route("/", apiDiscoveryApp); // /api/openapi.json, /api/rpc.discover
  api.route("/", rootDiscoveryApp); // /.well-known/openapi, /llms.txt
  api.route("/", gatewayPlatformApp);
  api.route("/", governanceApp);
  api.route("/", graphsApp);
  api.route("/", groupsApp);
  api.route("/", meApp); // /api/me/usage — personal spend/usage
  api.route("/", modelDefaultsApp);
  api.route("/", modelProvidersApp);
  api.route("/", monitorsApp);
  api.route("/", apiKeysApp);
  // Singular and plural are two disjoint surfaces: /api/organization is the
  // credential-implied management family; /api/organizations is the
  // self-hosted instance-admin provisioning family (absent, 404, unless the
  // instance key is configured on a non-SaaS deployment).
  api.route("/", organizationApp);
  api.route("/", organizationsApp);
  api.route("/", projectsApp);
  api.route("/", roleBindingsApp);
  api.route("/", rolesApp);
  api.route("/", scimTokensApp);
  api.route("/", promptsApp);
  api.route("/", scenarioEventsApp);
  api.route("/", scenariosApp);
  api.route("/", secretsApp);
  api.route("/", agentCacheApp);
  api.route("/", simulationRunsApp);
  api.route("/", suitesApp); // deprecated alias of the two families below
  api.route("/", runPlansApp); // /api/v1/run-plans
  api.route("/", testSuitesApp); // /api/v1/test-suites
  api.route("/", teamsApp);
  api.route("/", webhookPlatformApp);
  api.route("/", gatewaySpendApp);
  api.route("/", tracesApp);
  api.route("/", triggersApp);
  api.route("/", userAvatarApp); // /api/user-avatar/:projectId/:id — user avatars
  api.route("/", workflowsCrudApp); // CRUD — complements workflowsApp (code-completion, post_event)

  api.route("/", gatewayInternalApp);
  api.route("/", otelApp);
  api.route("/", rumApp); // /api/rum/v1/traces — browser telemetry proxy
  api.route("/", playgroundApp);
  api.route("/", langyApiApp); // /api/langy/conversations — key-authed turns
  api.route("/", langyUiActionsApp); // /api/langy/ui/actions — agent-to-page dispatch
  api.route("/", langyInternalApp);
  api.route("/", langyRelayApp);
  api.route("/", elevenLabsApp); // /api/elevenlabs/webhook/:modelProviderId
  api.route("/", githubApp);
  api.route("/", scenarioGenerateApp);
  api.route("/", scimApp);
  api.route("/", webhooksApp);

  api.route("/", adminApp);
  api.route("/", bugReportsApp); // /api/bug-reports — public issue-report intake
  api.route("/", annotationsApp);
  // ORDERING: authCliApp MUST be registered BEFORE authApp.
  // authApp owns the BetterAuth catch-all (`/auth/*`), which would
  // otherwise swallow `/auth/cli/*` and return 404 from BetterAuth.
  // Register the more-specific basePath first so Hono routes match it.
  api.route("/", authCliApp); // /api/auth/cli/* — RFC 8628 device-flow for CLI
  api.route("/", authApp);
  api.route("/", collectorApp);
  // ORDERING: must come after otelApp and collectorApp, whose namespaces its
  // aliases overlap — the real routes get their match first. It declines
  // anything it does not recognise, so apps mounted after it are unaffected.
  api.route("/", otelPathAliasApp);
  api.route("/", ingestionRoutesApp); // /api/ingest/* — Activity Monitor receivers
  api.route("/", cronApp);
  api.route("/", evaluationsLegacyApp);
  api.route("/", healthApp);
  api.route("/", miscApp);
  api.route("/", opsApp);
  api.route("/", sseApp);
  api.route("/", tracesLegacyApp);
  api.route("/", trpcApp);
  api.route("/", unsubscribeApp); // /api/unsubscribe — RFC 8058 one-click POST

  return api;
}
