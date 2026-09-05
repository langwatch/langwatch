/**
 * The API process's REST surface, composed for description rather than for service.
 */
import { Hono } from "hono";
import { ApiGovernanceIngestKeyProvenance } from "../../features/enterprise/governance-ingest-rest.mount";
import type { ErrorHandler, MiddlewareHandler } from "hono";

import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { createApiKeysRestApp } from "@langwatch/api-key-server";
import type { ConnectedAgentRuntime, LongPollTransportService } from "@langwatch/agent-server";
import type { AuthRestPorts } from "@langwatch/auth-server";
import { createGatewayPlatformRestApp, createGatewaySpendRestApp } from "@langwatch/gateway-server";
import type { GovernanceIngestRestPorts } from "@langwatch/enterprise-governance-server";
import { monitorApiMappingsSchema } from "@langwatch/monitor-contract";

import { REGISTRY_RBAC_VOCABULARY } from "../../app/api-packaged-rest.composition";

import { ApiSecretRestFeature } from "../../api-secret-rest.feature";
import { ApiRestSecurity } from "../../api-rest.security";
import {
  createApiProcessRestFeatures,
  type ApiProcessRestPorts,
  type ApiProcessRestServices,
} from "../../app-rest/app-rest.process-features";
import type {
  ApiPackagedRestCollaborators,
  ApiPackagedRestFamilyName,
} from "../../app-rest/app-rest.packaged-families";

/** A family the process serves that this composition cannot describe, and why. */
export type OpenApiSurfaceAbsence = Readonly<{
  /** The family, spelled the way the process's own composition names it. */
  family: string;
  /** What the caller loses, in one sentence. */
  because: string;
}>;

/** The composed description surface, and what it could not reach. */
export type OpenApiDocumentSurface = Readonly<{
  /** Every describable family, routed into ONE app. */
  app: Hono;
  /** Families deliberately left off, each with its reason. */
  absences: readonly OpenApiSurfaceAbsence[];
}>;

/**
 * A provider that refuses. Named rather than anonymous so a stack trace from a generation
 * run says which collaborator a route reached for, which is the whole diagnostic value of
 * refusing instead of handing back an empty object.
 */
function refuse<T>(what: string): () => T {
  return () => {
    throw new Error(`${what} is not available while generating the OpenAPI document`);
  };
}

/**
 * A collaborator whose SHAPE the description does not depend on. Spelled once, here, so
 * that the casts are countable rather than scattered: every use is a service object a
 * handler would call and generation never does.
 */
const opaque = <T>(): T => ({}) as T;

const noopMiddleware: MiddlewareHandler = async (_c, next) => {
  await next();
};

/**
 * Enforcement that authenticates nobody. The middleware chain is still BUILT for every
 * route, which is what registers each route's access policy in the route registry — and
 * that registry is what stamps per-operation security onto the generated document.
 */
function descriptionOnlySecurity(): AppRestSecurity {
  const refuseAtRuntime: ErrorHandler = (error) => {
    throw error;
  };
  return createAppRestSecurity({
    appContext: noopMiddleware,
    requestLogger: () => noopMiddleware,
    requestTracer: () => noopMiddleware,
    legacyErrorHandler: refuseAtRuntime,
    canonicalErrorHandler: refuseAtRuntime,
    authenticateProject: () => noopMiddleware,
    authorizeProjectPermission: () => noopMiddleware,
    authorizeApiKeyCeiling: () => noopMiddleware,
    authenticateOrganization: () => noopMiddleware,
    authorizeOrganizationPermission: () => noopMiddleware,
    authorizeRouteTeamPermission: () => noopMiddleware,
    authorizeRouteProjectPermission: () => noopMiddleware,
    authenticateOrganizationThrowing: noopMiddleware,
    authorizeOrganizationPermissionThrowing: () => noopMiddleware,
  } as never);
}

/**
 * The deployment origin the document's example links are built from. The hosted product's
 * own, because that is what an integrator reading the published document is looking at.
 */
const PUBLIC_BASE_URL = "https://app.langwatch.ai";

/** The packaged families' collaborators, all present so every one is mounted. */
function packagedCollaborators(): ApiPackagedRestCollaborators {
  return {
    services: {
      agentCache: refuse("The agent cache"),
      agents: refuse("Agents"),
      // Layers `/api/v1/agents/connect/*` and `/:id/call` onto the family
      // above (ADR-128). Production supplies it whenever connected agents
      // composed (`api-packaged-rest.composition.ts:171-173`); a stand-in
      // that omitted it would silently drop four documented operations.
      agentsV1: () => ({
        connectedRuntime: refuse<ConnectedAgentRuntime>("The connected-agent runtime"),
        connect: {
          transport: refuse<LongPollTransportService>("The long-poll transport"),
        },
        call: {
          runtime: refuse<ConnectedAgentRuntime>("The connected-agent runtime"),
          assertRunnable: refuse<Promise<void>>("Connected-agent runnability checks"),
        },
      }),
      apiKeys: refuse("API keys"),
      authzGrants: refuse("The grants ledger"),
      automation: refuse("Automations"),
      broadcast: refuse("Broadcast"),
      codingAgents: refuse("Coding agents"),
      codingAgentAudit: refuse("Coding agent audit"),
      dashboard: refuse("Dashboards"),
      datasets: refuse("Datasets"),
      evaluators: refuse("Evaluators"),
      experiments: refuse("Experiments"),
      governance: refuse("Governance"),
      modelProviders: refuse("Model providers"),
      monitors: refuse("Monitors"),
      organizations: refuse("Organizations"),
      organizationProvisioning: refuse("Organization provisioning"),
      permissions: refuse("Authorization"),
      projects: refuse("Projects"),
      roles: refuse("Custom roles"),
      scenarios: refuse("Scenarios"),
      scenarioTabs: refuse("Scenario tabs"),
      scim: refuse("SCIM provisioning"),
      secrets: refuse("Secrets"),
      simulations: refuse("Simulations"),
      storedObjects: refuse("Stored objects"),
      suites: refuse("Suites"),
      // A bag whose members refuse rather than a provider that does: the mount
      // reads the bag to build the family, and only a REQUEST would reach one
      // of the five ports inside it.
      trackedEvents: () => ({
        assertPredefinedEventPayload: refuse<undefined>("Tracked-event validation"),
        generateEventId: refuse<string>("Tracked-event id generation"),
        recordTrackedEvent: refuse<Promise<void>>("Tracked-event recording"),
        reportError: refuse<undefined>("The tracked-event error sink"),
        describeValidationError: refuse<string>("Tracked-event validation prose"),
      }),
      userAvatarObjects: refuse("Avatar object reads"),
      webhooks: refuse("Webhooks"),
      workflows: refuse("Workflows"),
    },
    ports: {
      agentPlatformUrl: () => `${PUBLIC_BASE_URL}/agents`,
      platformUrl: ({ projectSlug, path }) => `${PUBLIC_BASE_URL}/${projectSlug}${path}`,
      scenarioRunPlatformUrl: () => `${PUBLIC_BASE_URL}/simulations`,
      canonicalError: refuse("Canonical error rendering") as never,
      organizationMiddleware: noopMiddleware,
      managementAudit: () => {},
      organizationLedgerActor: refuse("Ledger attribution") as never,
      // The permission vocabulary is PUBLISHED: the custom-roles family
      // describes its request body from it, so an empty stand-in would narrow
      // the document's enum to nothing. The real one is a pure value.
      rbacVocabulary: REGISTRY_RBAC_VOCABULARY,
      instanceAdminKey: () => undefined,
      isSaas: () => true,
      reportError: () => {},
      rateLimit: refuse("Rate limiting") as never,
      // Likewise published: the monitor `mappings` body is a SHAPE the
      // document carries, so the schema has to be the real vocabulary.
      monitorMappingsSchema: monitorApiMappingsSchema,
      requireApiKeyPermission: () => noopMiddleware,
      traceUsageGuard: noopMiddleware,
      requireProjectPermission: refuse("Project permission checks") as never,
      dualAuth: noopMiddleware,
      enterpriseGate: () => noopMiddleware,
      authorizeDatasetDirectUpload: refuse("Dataset direct upload authorization") as never,
      extractInlineMedia: refuse("Inline media extraction") as never,
      triggerWorkflowEvaluation: refuse("Workflow evaluation dispatch") as never,
    },
  };
}

/** The process's own product services, all present so every family is mounted. */
function processServices(): ApiProcessRestServices {
  return {
    packaged: packagedCollaborators(),
    annotations: refuse("Annotations"),
    analytics: refuse("Analytics"),
    langWatchQL: {
      collaborators: opaque(),
      dashboard: refuse("Dashboards"),
    },
    prompts: refuse("Prompts"),
    organizations: refuse("The organization directory"),
    organizationManagement: {
      organizations: refuse("Organization management"),
      permissions: refuse("Authorization"),
      plans: refuse("Plans"),
      shares: refuse("Trace shares"),
      projects: refuse("Projects"),
      audit: () => {},
      invites: refuse("Organization invitations"),
      buildInviteAcceptUrl: (inviteCode) =>
        `${PUBLIC_BASE_URL}/invite/accept?inviteCode=${inviteCode}`,
    },
    scenarioRunExport: {
      simulations: refuse("Simulations"),
      broadcast: refuse("Broadcast"),
      session: refuse("Browser sessions") as never,
      recordExportRequested: async () => {},
    },
    authoring: {
      datasetGenerate: opaque(),
      workflowStudio: opaque(),
      scenarioGenerate: opaque(),
      playground: opaque(),
    },
    experimentWorkbench: opaque(),
    experimentInit: opaque(),
    evaluationBatch: opaque(),
    evaluationRun: opaque(),
    workflowRun: opaque(),
    // Spelled out rather than opaque because one of the three members DECIDES
    // a route: `PATCH /api/traces/{traceId}/metadata` is registered only where
    // the amendment is supplied, so an absent stand-in would silently drop a
    // documented operation and report it as removed.
    traceReads: {
      reads: opaque(),
      platformUrl: ({ projectSlug, path }) => `${PUBLIC_BASE_URL}/${projectSlug}${path}`,
      updateTraceMetadata: refuse<Promise<void>>("The trace metadata amendment"),
    },
    traceLegacy: {
      traces: refuse("The trace application"),
      shares: refuse("Trace shares"),
      reads: opaque(),
      credential: refuse("Handler-managed credentials") as never,
    },
  };
}

/** The process's own capabilities, all present so every family is mounted. */
function processPorts(): ApiProcessRestPorts {
  return {
    handlerManagedCredential: refuse("Handler-managed credentials") as never,
    rateLimit: refuse("Rate limiting") as never,
    otlpIngest: {
      credential: refuse("Ingestion credentials") as never,
      usageLimit: refuse("The usage meter") as never,
      traces: opaque(),
      logs: opaque(),
      metrics: opaque(),
    },
    collector: {
      credential: refuse("Ingestion credentials") as never,
      ingestSpan: refuse("Span ingestion") as never,
      deriveEvaluatorId: (name: string) => name,
    },
    bugReports: opaque(),
    unsubscribe: opaque(),
    langy: {
      turns: opaque(),
      uiActions: opaque(),
      internal: opaque(),
      relay: opaque(),
    },
    github: opaque(),
    authCliDeviceFlow: opaque(),
    governanceCli: opaque(),
    // The Better Auth family. It publishes no `describeRoute`, so omitting
    // it loses no operation — but it is in the served route table this
    // surface's "removed" list reads, so the prefix must be present too.
    auth: {
      betterAuth: refuse("The Better Auth instance"),
      revokeBrowserSession: refuse<Promise<void>>("Browser session revocation"),
      resolveSession: refuse("Browser session resolution") as never,
      tryFindProjectSlugByToken: refuse<Promise<string | null>>("Legacy token project lookup"),
      featureFlags: refuse("The feature-flag store"),
      directory: refuse("The member directory") as AuthRestPorts["directory"],
      baseUrl: PUBLIC_BASE_URL,
      federatedLogout: refuse<Promise<string | null>>("Federated logout"),
      runWithIdentityBirth: (run) => run(),
    },
    // The SCIM 2.0 provisioning surface. Both families are described: the
    // fifteen protocol operations are the frozen document's largest single
    // block, and the Auth0 intake carries no `describeRoute`, so mounting it
    // here adds a served route and no operation.
    scim: {
      scim: refuse("The SCIM directory-sync service"),
      webhookSecret: () => undefined,
    },
    governanceIngest: {
      governance: refuse("Governance"),
      projects: refuse("The internal project directory"),
      traceCollection: opaque(),
      logCollection: opaque(),
      metricCollection: opaque(),
      // Named through the port rather than through the client type it returns:
      // only `repositories/prisma/**` and the Postgres adapters may spell
      // `PrismaClient`, and a description task is neither.
      directory: refuse("The member directory") as GovernanceIngestRestPorts["directory"],
      keyProvenance: ApiGovernanceIngestKeyProvenance.create(),
    },
    publicBaseUrl: PUBLIC_BASE_URL,
    healthProbes: opaque(),
    opsClickHouseExplain: opaque(),
    dspySteps: opaque(),
    mcpAuthorize: opaque(),
    imageProxy: { blockLocalHttpCalls: true, allowedHosts: [] },
  };
}

/**
 * The families the process mounts BESIDE `createApiProcessRestFeatures`.
 * `api-production.composition.ts` routes five more apps after that list, and four of them
 * publish operations.
 */
function mountProcessTailFamilies(options: {
  app: Hono;
  security: AppRestSecurity;
  absences: OpenApiSurfaceAbsence[];
}): void {
  const { app, security } = options;

  app.route(
    "/",
    ApiSecretRestFeature.create({
      secrets: opaque(),
      security: ApiRestSecurity.projectPolicy({
        apiKeys: opaque(),
        authz: opaque(),
        organizations: opaque(),
      }),
    }),
  );

  app.route(
    "/",
    createApiKeysRestApp({
      security,
      apiKeys: refuse("API keys"),
      permissions: refuse("Authorization"),
      audit: () => {},
    }).hono as unknown as Hono,
  );

  app.route(
    "/",
    createGatewayPlatformRestApp({
      security,
      gateway: refuse("The gateway control plane"),
    }).hono as unknown as Hono,
  );

  app.route(
    "/",
    createGatewaySpendRestApp({
      security,
      billingPlanGate: noopMiddleware,
      canonicalError: refuse("Canonical error rendering") as never,
      spend: refuse("Gateway spend"),
    }).hono as unknown as Hono,
  );

  options.absences.push(
    {
      family: "gateway-internal",
      because:
        "its composition reads a live Prisma connection and the gateway service graph at BUILD time, not per request; the family is ingress-blocked and publishes no operations, so leaving it out costs the document nothing",
    },
    {
      family: "elevenlabs-webhook",
      because:
        "the same live Prisma connection at build time; the route is a vendor callback and carries no describeRoute, so it publishes no operations either",
    },
  );
}

/**
 * Every family the process mounts, in one app, described and never served.
 */
export function composeOpenApiDocumentSurface(): OpenApiDocumentSurface {
  const security = descriptionOnlySecurity();
  const app = new Hono();
  const absences: OpenApiSurfaceAbsence[] = [];

  for (const family of createApiProcessRestFeatures({
    security,
    services: processServices(),
    ports: processPorts(),
    packagedAbsence: {
      absent: (family: ApiPackagedRestFamilyName) => {
        absences.push({
          family,
          because:
            "the packaged mount named it absent at boot; see mountApiPackagedRestFamilies for what this process cannot build it from",
        });
      },
    },
  })) {
    app.route("/", family);
  }

  mountProcessTailFamilies({ app, security, absences });

  return { app, absences };
}
