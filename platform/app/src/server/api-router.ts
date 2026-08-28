/**
 * Unified Hono API router — all /api/* routes mounted here.
 * Each sub-app sets its own basePath (e.g. "/api/traces").
 */

import { app as scimApp } from "~/server/enterprise/scim/routes";
import { app as webhooksApp } from "~/server/enterprise/scim/webhooks";
import { Hono, type MiddlewareHandler } from "hono";
import { appRestSecurity } from "~/server/api/security";
import type { GuardrailAttachment } from "@langwatch/gateway-contract";
import {
  applicableEndUserCaps,
  FixedGatewaySettlementPolicy,
  GatewayUsageService,
  loadTraceDestinationFacts,
  settlementGraceMs,
  toVirtualKeySnakeDto,
} from "@langwatch/gateway-server";
import type {
  GatewayPlatformRestPorts,
  GatewayRestActor,
  GatewaySpendRestPorts,
} from "@langwatch/platform-api";
import { createExportTracesRestApp } from "@langwatch/platform-api";
import {
  createAppRestFeatures,
  ForbiddenError,
  requestTraceIds,
} from "@langwatch/platform-api/app-rest";
import { app as adminApp } from "~/server/routes/ops/admin";
import { app as analyticsApp } from "../app/api/analytics/[...route]/app";
import { app as analyticsSqlApp } from "../app/api/analytics-sql/[[...route]]/app";
import { app as exportScenarioRunsApp } from "../app/api/export/scenario-runs/[[...route]]/app";
import { app as organizationApp } from "../app/api/organization/[[...route]]/app";
import { app as promptsApp } from "../app/api/prompts/[[...route]]/app";
import { secretPublicRestApp } from "../runtime/app/features/secret";
import { app as tracesApp } from "../app/api/traces/[[...route]]/app";
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
import { createTRPCApp } from "./routes/trpc";
import { appContextMiddlewareFor } from "~/app/api/middleware/app-context";
import type { App } from "~/server/app-layer/app";
import { app as unsubscribeApp } from "./routes/unsubscribe";
import { app as workflowsApp } from "./routes/workflows";

// --- capabilities the packaged REST families reach through, but do not own ---
import { AgentCacheService } from "~/app/api/agent-cache/agent-cache.service";
import { agentPlatformUrl } from "../app/api/agents/agent-platform-url";
import { PromptStudioAdapter } from "../app/api/copilotkit/[[...route]]/service-adapter";
import { authorizeDirectUpload } from "../app/api/dataset/direct-upload-auth";
import { blockTraceUsageExceededMiddleware } from "~/app/api/middleware";
import { dualAuth } from "~/app/api/middleware/dual-auth";
import { requireEnterprisePlanRest } from "~/app/api/middleware/enterprise-gate";
import { organizationMiddleware } from "~/app/api/middleware/organization";
import { canonicalErrorFor } from "~/app/api/shared/canonical-error";
import { orgRequestLedgerActor } from "~/app/api/shared/ledger-actor";
import { platformUrl } from "~/app/api/shared/platform-url";
import { scenarioRunPlatformUrl } from "../app/api/simulation-runs/scenario-run-platform-url";
import type { ProjectIdentity } from "@langwatch/project-contract";
import { auditLog } from "~/runtime/app/features/audit-log";
import {
  assertWebhookEndpointsEntitled,
  WebhookEndpointsNotEntitledError,
} from "~/runtime/app/features/webhooks";
import { LegacyAgentsRestFeature } from "~/runtime/app/legacy-rest/agents";
import { requireApiKeyPermission } from "~/server/api-key/auth-middleware";
import { withIdempotency } from "~/server/api/idempotency";
import { managementAuditPort } from "~/server/api/management/audit";
import { instanceAdminApiKey } from "~/server/api/management/instance-admin-key";
import { appRestRbacVocabulary } from "~/server/api/management/rbac-vocabulary";
import type { Permission } from "~/server/api/rbac";
import { getUserProtectionsForProject } from "~/server/api/utils";
import { predefinedEventsSchemas, predefinedEventTypes } from "@langwatch/trace-contract";
import {
  generateTrackedEventId,
  recordTrackedEventSpan,
} from "~/server/app-layer/events/track-event.service";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { ClickHouseUnavailableError } from "~/server/app-layer/traces/errors";
import { getServerAuthSession } from "~/server/auth";
import { requireProjectPermission } from "~/server/auth/permissions";
import { prisma } from "~/server/db";
import { ExportFailedError, ExportUnauthenticatedError } from "~/server/export/errors";
import { exportRequestSchema } from "~/server/export/types";
import { resolveSpendScope } from "~/server/gateway/spendScope";
import {
  assertActorCanManageAllScopes,
  assertActorCanOperateOnAnyScope,
  assertGuardrailAttachmentsAllowed,
  assertScopesBelongToOrg,
  assertTraceProjectBelongsToOrg,
  isVisibleToMembership,
  type MembershipSet,
  requireExistingVk,
  requireVisibleVk,
  resolveVkProjectId,
  type VirtualKeyActor,
} from "~/server/gateway/virtualKey.authz";
import { virtualKeyBudgetInputSchema } from "~/server/gateway/virtualKey.service";
import { resolveCallerProjectScope } from "~/server/organizations/resolveCallerProjectScope";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import { rateLimit } from "~/server/rateLimit";
import { bodyLimit } from "./routes/_lib/body-limit";
import { extractInlineMediaFromEvent } from "./stored-objects/content-extractor";
import { monitorMappingsSchema } from "~/server/tracer/tracesMapping";
import { webhookDestinationFor } from "~/server/webhooks/destinations";
import { WorkflowEvaluationService } from "~/server/workflows/workflowEvaluation.service";
import type { NextRequest } from "~/types/next-stubs";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { zodErrorMessage } from "~/utils/zodErrorMessage";

/**
 * A project credential stands in for someone working in its project, so it
 * sees organization-scoped keys, its own team's keys and its own project's —
 * and not a sibling team's. The same rule the tRPC list uses.
 */
function membershipForProjectCredential(project: ProjectIdentity): MembershipSet {
  return {
    isOrgMember: true,
    isOrgAdmin: false,
    teamIds: new Set([project.teamId]),
    projectIds: new Set([project.id]),
  };
}

/**
 * The process's receipt ledger, as the gateway REST port takes it. A named
 * generic rather than an arrow so the port's own type parameter survives.
 */
function runIdempotently<T>(input: {
  operation: string;
  scopeId: string;
  key: string | null;
  validatedBody: unknown;
  handler: () => Promise<{ status: number; body: T }>;
}) {
  return withIdempotency({ prisma, ...input });
}

/**
 * The one seam between the public gateway REST surface and this application.
 * Every entry fronts the SAME module the gateway's tRPC routers reach through
 * `gatewayTrpcPorts`, so the two doors cannot enforce different rules.
 */
function gatewayPlatformRestPorts(app: App): GatewayPlatformRestPorts {
  const asActor = (actor: GatewayRestActor) => actor as VirtualKeyActor;
  return {
    virtualKeys: app.gateway.virtualKeys,
    budgets: app.gateway.budgetDecisions,
    spendSourceAvailable: app.gateway.virtualKeySpend !== undefined,
    organizationIdForProject: async (projectId) => {
      const found = await prisma.project.findUnique({
        where: { id: projectId },
        include: { team: true },
      });
      if (!found) throw new Error(`project ${projectId} missing team`);
      return found.team.organizationId;
    },
    // A scoped API key acts as its owning user; a legacy project key carries
    // none, so it acts as a stable machine principal for its project, which
    // keeps an audit row traceable back to the credential that wrote it.
    actorForCredential: ({ projectId, resolvedToken }) =>
      resolvedToken?.type === "apiKey"
        ? {
            actor: {
              kind: "apiKey",
              apiKeyId: resolvedToken.apiKeyId,
              userId: resolvedToken.userId,
              organizationId: resolvedToken.organizationId,
            },
            actorUserId: resolvedToken.userId ?? `svc_${projectId}`,
          }
        : {
            actor: { kind: "legacyProjectKey", projectId },
            actorUserId: `svc_${projectId}`,
          },
    visibleToProjectCredential: ({ project, virtualKeys }) => {
      const membership = membershipForProjectCredential(project);
      return virtualKeys.filter((vk) => isVisibleToMembership(membership, vk.scopes));
    },
    requireVisibleVirtualKey: ({ project, id, organizationId }) =>
      requireVisibleVk(app.gateway.virtualKeys, membershipForProjectCredential(project), {
        id,
        organizationId,
      }),
    requireExistingVirtualKey: ({ id, organizationId }) =>
      requireExistingVk(app.gateway.virtualKeys, id, organizationId),
    assertCanManageAllScopes: ({ actor, scopes }) =>
      assertActorCanManageAllScopes({ prisma, actor: asActor(actor) }, [...scopes]),
    assertCanOperateOnAnyScope: ({ actor, scopes, permission }) =>
      assertActorCanOperateOnAnyScope(
        { prisma, actor: asActor(actor) },
        [...scopes],
        permission as Permission,
      ),
    assertScopesBelongToOrganization: ({ organizationId, scopes }) =>
      assertScopesBelongToOrg(prisma, organizationId, [...scopes]),
    assertTraceProjectBelongsToOrganization: ({ organizationId, traceProjectId }) =>
      assertTraceProjectBelongsToOrg(prisma, organizationId, traceProjectId),
    assertGuardrailAttachmentsAllowed: ({ actor, projectId, attachments }) =>
      assertGuardrailAttachmentsAllowed(
        { prisma, actor: asActor(actor) },
        projectId,
        attachments as GuardrailAttachment[] | undefined,
      ),
    resolveVirtualKeyProjectId: ({ organizationId, virtualKeyId, scopes, traceProjectId }) =>
      resolveVkProjectId(prisma, organizationId, {
        vkId: virtualKeyId,
        inputScopes: scopes ? [...scopes] : undefined,
        traceProjectId,
      }),
    // One read of the destinations for the whole page: a listing must not cost
    // a query per key to say where each one's traffic goes.
    toVirtualKeyDtos: async ({ virtualKeys }) => {
      const facts = await loadTraceDestinationFacts({
        projects: app.projects,
        virtualKeys: [...virtualKeys],
      });
      return virtualKeys.map((virtualKey) => toVirtualKeySnakeDto({ virtualKey, facts }));
    },
    groupMemberCounts: async (budgets) => {
      const groupIds = Array.from(
        new Set(budgets.filter((b) => b.scopeType === "GROUP").map((b) => b.scopeId)),
      );
      if (groupIds.length === 0) return new Map();
      const groups = await prisma.group.findMany({
        where: { id: { in: groupIds } },
        select: { id: true, _count: { select: { members: true } } },
      });
      return new Map(groups.map((g) => [g.id, g._count.members]));
    },
    spendByVirtualKey: ({ organizationId, virtualKeyIds, window }) =>
      GatewayUsageService.create({
        prisma,
        chRepo: undefined,
        spendRepo: app.gateway.virtualKeySpend,
      }).spendByVirtualKey({ organizationId, virtualKeyIds: [...virtualKeyIds], window }),
    idempotency: runIdempotently,
    schemas: { virtualKeyBudgetInput: virtualKeyBudgetInputSchema },
  };
}

/** The ledger, the replay path and the scope resolver the spend reads use. */
function gatewaySpendRestPorts(app: App): GatewaySpendRestPorts {
  return {
    spendEvents: app.gateway.spendEvents,
    budgetSpend: app.gateway.budgets,
    webhookEndpoints: app.gateway.webhookEndpoints,
    webhookEvents: app.gateway.webhookEvents,
    webhookDelivery: app.gateway.webhookDelivery,
    settlementPolicy: FixedGatewaySettlementPolicy.create(
      settlementGraceMs(process.env.LW_SPEND_SETTLEMENT_GRACE_MS),
    ),
    resolveSpendScope,
    endUserCaps: ({ budgetRepository, organizationId, endUserId, tenantIds, virtualKeyId }) =>
      applicableEndUserCaps({
        prisma,
        budgetRepository,
        organizationId,
        endUserId,
        tenantIds,
        virtualKeyId,
      }),
    spendStoreUnavailable: () => new ClickHouseUnavailableError(),
  };
}

/**
 * ADR-072: the pull API gates under the webhook platform's plan flag, because
 * pull and push are two views of one enterprise capability.
 */
const gatewaySpendBillingGate: MiddlewareHandler = async (c, next) => {
  const organization = c.get("organization") as { id: string };
  try {
    await assertWebhookEndpointsEntitled(organization.id);
  } catch (error) {
    if (error instanceof WebhookEndpointsNotEntitledError) {
      throw new ForbiddenError(
        "The billing events API is an enterprise feature; this organization's plan does not include it.",
      );
    }
    throw error;
  }
  await next();
};

/** One agent cache store per process; the entries expire on their own. */
const agentCacheStore = new AgentCacheService();

export function createApiRouter(app: App) {
  const api = new Hono();
  const processTrpcApp = createTRPCApp(app);

  api.use("*", appContextMiddlewareFor(app));

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
  api.route("/", datasetGenerateApp); // /api/dataset/generate (before the dataset family's /:slugOrId)
  api.route("/", workflowsApp); // /api/workflows/code-completion, /post_event
  api.route("/", healthChecksApp); // /api/health/collector, /evaluations, etc.

  api.route("/", analyticsApp);
  api.route("/", analyticsSqlApp); // /api/v1/projects/:projectId/analytics/* — governed SQL
  // experimentsV3App owns the session-authenticated execute/abort endpoints and
  // the API-key-authenticated run/runs endpoints; the packaged experiments
  // family owns the project-API-key list endpoint (GET /api/experiments). Both
  // live under /api/experiments. v3 mounts first so its specific handlers (e.g.
  // POST /api/experiments/execute, a session-cookie request) match before any
  // sibling route resolution, and so its literal `/runs` siblings are not
  // swallowed by the packaged family's `:slug`. The packaged family
  // authenticates per-route via the SecuredApp builder (no namespace-wide
  // guard), so this ordering is belt-and-suspenders; the experiments-route-auth
  // regression test pins both directions.
  api.route("/", experimentsV3App);
  api.route("/", experimentsV3LegacyAliasApp); // /api/evaluations/v3/... → /api/experiments/...
  // The trace export resolves a browser session in-handler rather than taking a
  // project credential, so its ports are generic over the request schema, the
  // session and the viewer's protections — which `createAppRestFeatures` is
  // not. It is mounted directly for that reason, and is therefore invisible to
  // the route-authorization audit that reads that one list.
  api.route(
    "/",
    createExportTracesRestApp({
      security: appRestSecurity,
      ports: {
        requestSchema: exportRequestSchema,
        resolveSession: (request) => getServerAuthSession({ app, req: request as NextRequest }),
        probeProjectPermission: (session, projectId, permission) =>
          probeProjectPermission({ session }, projectId, permission),
        getViewerProtections: (session, { projectId }) =>
          getUserProtectionsForProject({ prisma, session, app }, { projectId }),
        exports: () => app.traces.export,
        broadcast: () => app.broadcast,
        unauthenticatedError: () => new ExportUnauthenticatedError(),
        exportFailedError: (cause) => new ExportFailedError(cause),
      },
    }).hono,
  );
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
  api.route("/", apiDiscoveryApp); // /api/openapi.json
  api.route("/", rootDiscoveryApp); // /.well-known/openapi, /llms.txt
  // Most REST families now live in `@langwatch/platform-api` and are mounted by
  // factory rather than by import. `createAppRestFeatures` is their single
  // enumeration — the same one the route-registry audits build from — so a
  // family cannot be served while being invisible to the authorization audit.
  for (const packagedRestApp of createAppRestFeatures({
    security: appRestSecurity,
    services: {
      agentCache: () => agentCacheStore,
      agents: () => LegacyAgentsRestFeature.create({ prisma, session: null }),
      apiKeys: () => app.apiKeys,
      authzGrants: () => app.authzGrants,
      automation: () => app.automation,
      broadcast: () => app.broadcast,
      codingAgents: () => ({
        codingAgents: app.codingAgents,
        githubWebBase: () => app.github.getWebBase(),
        resolveOrganizationId,
        resolveCallerProjectScope,
        auditLog,
      }),
      dashboard: () => app.dashboard,
      datasets: () => app.dataset,
      evaluators: () => app.evaluators,
      experiments: () => app.experiments,
      gatewayPlatform: () => gatewayPlatformRestPorts(app),
      gatewaySpend: () => gatewaySpendRestPorts(app),
      governance: () => app.governance,
      modelProviders: () => app.modelProviders,
      monitors: () => app.monitors,
      organizations: () => app.organizations,
      permissions: () => app.permissions,
      projects: () => app.projects,
      roles: () => app.roles,
      scenarios: () => app.scenarios,
      scenarioTabs: () => app.scenarioTabs,
      scim: () => app.scim,
      secrets: () => app.secrets,
      simulations: () => app.simulations,
      storedObjects: () => app.storedObjects,
      storedObjectOwners: () => app.storedObjectOwners,
      suites: () => app.suites,
      userAvatarObjects: () => app.userAvatarObjects,
      webhooks: () => ({
        endpoints: app.gateway.webhookEndpoints,
        health: app.gateway.webhookHealth,
        events: app.gateway.webhookEvents,
        assertEndpointsEntitled: assertWebhookEndpointsEntitled,
        dispatch: ({ destination, ...input }) => webhookDestinationFor(destination).send(input),
        runIdempotent: (input) => withIdempotency({ prisma, ...input }),
      }),
      workflows: () => app.workflows,
    },
    ports: {
      agentPlatformUrl,
      authorizeDatasetDirectUpload: authorizeDirectUpload,
      bodyLimit,
      canonicalError: (error, c) => canonicalErrorFor(error, requestTraceIds(c)),
      copilotServiceAdapterFor: ({ projectId }) =>
        new PromptStudioAdapter({
          projectId,
          nlpLambda: app.nlpLambda,
          modelProviders: app.modelProviders,
          workflows: app.workflows,
        }),
      dualAuth,
      enterpriseGate: requireEnterprisePlanRest,
      extractInlineMedia: (input) =>
        extractInlineMediaFromEvent({ ...input, service: app.storedObjects }),
      gatewaySpendBillingGate,
      instanceAdminKey: instanceAdminApiKey,
      isSaas: () => app.config.isSaas,
      managementAudit: managementAuditPort,
      monitorMappingsSchema,
      organizationLedgerActor: orgRequestLedgerActor,
      organizationMiddleware,
      platformUrl,
      rateLimit,
      rbacVocabulary: appRestRbacVocabulary,
      reportError: (error) => captureException(toError(error)),
      requireApiKeyPermission: (permission) => requireApiKeyPermission({ permission }),
      requireProjectPermission,
      scenarioRunPlatformUrl,
      trackedEvents: {
        assertPredefinedEventPayload: (rawBody) => {
          if (
            typeof rawBody.event_type === "string" &&
            predefinedEventTypes.includes(
              rawBody.event_type as (typeof predefinedEventTypes)[number],
            )
          ) {
            predefinedEventsSchemas.parse(rawBody);
          }
        },
        generateEventId: generateTrackedEventId,
        recordTrackedEvent: (input) => recordTrackedEventSpan(input),
        reportError: (error) => captureException(toError(error)),
        describeValidationError: zodErrorMessage,
      },
      traceUsageGuard: blockTraceUsageExceededMiddleware,
      triggerWorkflowEvaluation: (input) =>
        WorkflowEvaluationService.create(
          prisma,
          app.experiments,
          app.modelProviders,
          app.nlpLambda,
          app.workflows,
          app.config.evaluationExecution.defaultConcurrency,
        ).triggerEvaluationForRest(input),
    },
  })) {
    api.route("/", packagedRestApp);
  }
  // /api/organization is the credential-implied management family. Its plural
  // sibling — the self-hosted instance-admin provisioning family, absent unless
  // the instance key is configured on a non-SaaS deployment — is a disjoint
  // surface and is now mounted from the factory loop above.
  api.route("/", organizationApp);
  api.route("/", promptsApp);
  api.route("/", secretPublicRestApp);
  api.route("/", tracesApp);

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
  api.route("/", processTrpcApp);
  api.route("/", unsubscribeApp); // /api/unsubscribe — RFC 8058 one-click POST

  return api;
}
