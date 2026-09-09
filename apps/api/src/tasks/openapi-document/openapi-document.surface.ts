/**
 * The API process's REST surface, composed for description rather than for service.
 */
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";

import type { AuthRestPorts } from "@langwatch/auth-server";
import type { GovernanceIngestRestPorts } from "@langwatch/enterprise-governance-server";


import { openApiRestDoors } from "../../app-rest/api-rest.doors.ts";
import { createApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";
import type { ApiRestPorts, ApiRestServices } from "../../app-rest/api-rest.services.ts";
import type { ApiPackagedRestCollaborators } from "../../app-rest/api-rest.packaged-services.ts";

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
      agentsV1: () => ({ connect: {}, call: {} }),
      apiKeys: refuse("API keys"),
      automation: refuse("Automations"),
      broadcast: refuse("Broadcast"),
      codingAgents: refuse("Coding agents"),
      dashboard: refuse("Dashboards"),
      // NOT stood up: `/api/dataset`'s eight undeclarable routes are still
      // described from the frozen document, and mounting the declared half here
      // would publish a half of the family the document does not have.
      evaluators: refuse("Evaluators"),
      experiments: refuse("Experiments"),
      governance: refuse("Governance"),
      modelProviders: refuse("Model providers"),
      monitors: refuse("Monitors"),
      organizations: refuse("Organizations"),
      organizationProvisioning: refuse("Organization provisioning"),
      permissions: refuse("Authorization"),
      projects: refuse("Projects"),
      scenarios: refuse("Scenarios"),
      scenarioTabs: refuse("Scenario tabs"),
      scim: refuse("SCIM provisioning"),
      simulations: refuse("Simulations"),
      storedObjects: refuse("Stored objects"),
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
      handlerManagedCredential: refuse("The project credential door"),
      legacyErrors: refuse("Error rendering") as never,
      instanceAdminKey: () => undefined,
      isSaas: () => true,
      reportError: () => {},
      rateLimit: refuse("Rate limiting") as never,
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
function processServices(): ApiRestServices {
  return {
    annotations: refuse("Annotations"),
    // The monitoring-keyed liveness report is deliberately NOT described: it
    // publishes no operation an integrator can call, and standing it up here
    // would add a family to the document the previous surface never carried.
    secrets: refuse("The secret store"),
    suites: refuse("The suite application"),
    billingWebhook: refuse("The payment provider callback"),
    analytics: refuse("Analytics"),
    langWatchQL: {
      collaborators: opaque(),
      dashboard: refuse("Dashboards"),
    },
    prompts: {
      service: refuse("Prompts"),
      tagCatalog: refuse("The prompt application"),
      permissions: refuse("Authorization"),
    },
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
function processPorts(): ApiRestPorts {
  return {
    handlerManagedCredential: refuse("Handler-managed credentials") as never,
    rateLimit: refuse("Rate limiting") as never,
    errors: refuse("Error rendering") as never,
    platformUrl: ({ projectSlug, path }) => `${PUBLIC_BASE_URL}/${projectSlug}${path}`,
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
 * Every family the process mounts, in one app, described and never served.
 */
export function composeOpenApiDocumentSurface(): OpenApiDocumentSurface {
  const app = new Hono();
  // The two families the registry does not name at all: both read a live
  // Prisma connection and their service graph at BUILD time rather than per
  // request, and neither carries a `describeRoute`, so leaving them out costs
  // the document no operation.
  const absences: OpenApiSurfaceAbsence[] = [
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
  ];
  const runtime = createApiRestRuntime({
    projectCredential: refuse("The project credential door"),
    organizationCredential: refuse("The organization credential door"),
    organizationIdentity: refuse("The organization credential door"),
    routeAuthorization: refuse("Route-scoped authorization"),
    directoryCredential: refuse("The SCIM directory bearer"),
    errors: refuse("Error rendering") as never,
    dualCredential: noopMiddleware,
  });

  for (const door of openApiRestDoors({
    context: {
      runtime,
      services: processServices(),
      ports: processPorts(),
      packaged: packagedCollaborators(),
    },
    report: {
      absent: (family: string, because: string) => {
        absences.push({ family, because });
      },
    },
  })) {
    app.route("/", door);
  }

  return { app, absences };
}
