/**
 * Stub builders for the nine collaborator halves a per-half integration test
 * is NOT exercising, plus the shared `stub()` proxy every one of those tests
 * already used to fake a namespace's build-time surface.
 *
 * Each per-half integration test composes ONE real half (the one its file
 * names) and needs the other nine only well enough for
 * `ApiTrpcFeaturesComposition.tryCompose(...).build(mount)` to construct the
 * full ninety-one-namespace router — which reads every namespace's input
 * schemas and middleware wrappers at BUILD time, not only the ones a test's
 * own HTTP call reaches. `testHalves()` returns all ten stubbed by default;
 * pass the one(s) under test as overrides.
 */
import { EventEmitter } from "node:events";
import { z } from "zod";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import type {
  ApiTrpcCollaboratorHalves,
  ApiTrpcFeatureApplicationSlices,
} from "../api-trpc-features.composition";
import type { ApiExecutionCollaborators } from "../api-trpc-collaborators.execution.composition";
import { createGatewayTrpcRouters } from "../../features/gateway/gateway-trpc.mount";
import { refusingLangyFeature } from "../../features/langy/langy.composition";
import { refusingOpsFeature } from "../../features/ops/ops.composition";
import { refusingAnalyticsFeature } from "../../features/analytics/analytics.composition";
import { refusingDataRetentionFeature } from "../../features/data-retention/data-retention.composition";
import { refusingMonitorFeature } from "../../features/monitor/monitor.composition";
import { refusingScenarioFeature } from "../../features/scenario/scenario.composition";
import { refusingStoredObjectFeature } from "../../features/stored-object/stored-object.composition";
import type { ComposedApiFeatures } from "../../app-trpc/app-trpc.composed";
import type { ApiIdentityCollaborators } from "../api-trpc-collaborators.identity.composition";
import type { ApiOrgGroupCollaborators } from "../api-trpc-collaborators.org-group.composition";
import type { ApiProductGroupCollaborators } from "../api-trpc-collaborators.product-group.composition";
import type { ApiProductCollaborators } from "../api-trpc-collaborators.product.composition";
import type { ApiTraceGroupCollaborators } from "../api-trpc-collaborators.trace-group.composition";

const anySchema = z.any();
const passThroughMiddleware = ({ next }: { next: () => unknown }) => next();

/**
 * A collaborator surface with only the members the record reads while it is
 * being BUILT. Everything else answers a function that refuses by name if a
 * call actually reaches it — a stub is a promise about what a test drives,
 * not a full fake.
 */
export function stub<T>(group: string, buildTime: Record<string, unknown> = {}): T {
  return new Proxy(buildTime, {
    get(target, property) {
      if (property in target) return target[property as string];
      return () => {
        throw new Error(`the test reached ${group}.${String(property)}, which it does not stub`);
      };
    },
    has: () => true,
  }) as T;
}

/**
 * @param broadcast The tenant fan-out `ctx.app.broadcast.getTenantEmitter()`
 * returns. A real `EventEmitter`, not a stub: a subscription test emits on
 * this instance and asserts the SSE lane relays it, so it has to be the SAME
 * object both the caller and the test hold.
 */
export function stubIdentityHalf(broadcast: EventEmitter): ApiIdentityCollaborators {
  return stub<ApiIdentityCollaborators>("identity", {
    organizationRest: stub("identity.organizationRest"),
    organizationProvisioning: stub("identity.organizationProvisioning"),
    broadcast: {
      getTenantEmitter: () => broadcast,
      cleanupTenantEmitter: () => undefined,
    },
    application: {
      apiKeys: stub("app.apiKeys"),
      // Overwritten by the ops feature's full `OpsApp` once that feature is
      // real; this narrow reader is what a process with no ops feature
      // composed leaves behind.
      broadcast: {
        getTenantEmitter: () => broadcast,
        cleanupTenantEmitter: () => undefined,
      },
      config: {},
      ops: { isAdmin: () => true },
      organizations: stub("app.organizations"),
      presence: stub("app.presence"),
      users: stub("app.users"),
    },
    auth: stub("auth"),
    group: stub("group"),
    identity: stub("identity"),
    joinRequests: stub("joinRequests"),
    onboarding: stub("onboarding", { signUpDataSchema: anySchema }),
    user: stub("user"),
  });
}

export function stubExecutionHalf(): ApiExecutionCollaborators {
  return stub<ApiExecutionCollaborators>("execution", {
    workflows: stub("app.workflows"),
    experiments: stub("app.experiments"),
    evaluations: stub("app.evaluations"),
    workflowPorts: {
      lifecycle: stub("workflows.lifecycle"),
      optimization: stub("workflows.optimization"),
    },
    experimentPorts: stub("experiments", { workbenchStateSchema: anySchema }),
    evaluationPorts: stub("evaluations", { mappingsSchema: anySchema }),
  });
}

export function stubProductGroupHalf(): ApiProductGroupCollaborators {
  return stub<ApiProductGroupCollaborators>("productGroup", {
    authzApp: stub("app.authzApp"),
    datasetApp: stub("app.dataset"),
    evaluatorApp: stub("app.evaluatorApp"),
    featureFlagService: stub("app.featureFlags"),
    permissions: stub("app.permissions"),
    projectReads: stub("app.projects", { getOrganizationId: async () => "organization-1" }),
    promptApp: stub("app.prompts"),
    roleApp: stub("app.roles"),
    batchRecordPorts: stub("batchRecord"),
    datasetPorts: stub("dataset"),
    evaluatorPorts: stub("evaluators"),
    homePorts: stub("home"),
    promptPorts: stub("prompts"),
    rolePorts: stub("role", { customRolePermission: anySchema }),
    teamPorts: stub("team"),
  });
}

export function stubTraceGroupHalf(): ApiTraceGroupCollaborators {
  return stub<ApiTraceGroupCollaborators>("traceGroup", {
    traces: stub("app.traces"),
    share: stub("app.share"),
    dataRetention: stub("app.dataRetention"),
    topics: stub("app.topics"),
    modelProviders: stub("app.modelProviders"),
    planProvider: stub("app.planProvider"),
    ports: {
      traces: stub("traces", {
        listInputSchema: anySchema,
        filterInputSchema: anySchema,
        evaluatorTypeSchema: anySchema,
        preconditionSchema: anySchema,
      }),
      tracesV2: stub("tracesV2", { traceMetadataUpdateSchema: anySchema }),
      spans: stub("spans"),
      traceEditOverlay: stub("traceEditOverlay"),
      sharedTrace: stub("sharedTrace"),
      savedViews: stub("savedViews"),
      costs: stub("costs"),
      llmModelCost: stub("llmModelCost"),
      modelProvider: stub("modelProvider"),
      modelProviderChecks: {
        tenantWrite: () => passThroughMiddleware,
        credentialProbe: passThroughMiddleware,
      },
      translate: stub("translate"),
      httpProxy: stub("httpProxy"),
      limits: stub("limits"),
    },
  });
}

/**
 * The plan lookup and the flag store the record's own compositions read, as a
 * suite that drives neither supplies them: every organization is on the free
 * plan and inside every rollout, so a feature gated on either still MOUNTS and
 * a suite asserting on the gate itself overrides them.
 */
export function stubInfrastructureEntitlements(): Pick<
  ApiTrpcInfrastructure,
  "plans" | "featureFlags" | "saasBilling"
> {
  return {
    plans: { getActivePlan: async () => ({ type: "FREE" }) as never },
    featureFlags: stub("featureFlags", { isEnabled: async () => true }),
    // Self-hosted, so the two Enterprise billing namespaces mount as the empty
    // routers of the same served type. A suite asserting on billing overrides it.
    saasBilling: false,
  };
}

export function stubProductHalf(): ApiProductCollaborators {
  return stub<ApiProductCollaborators>("product", {
    annotations: stub("app.annotations"),
    annotationPorts: stub("annotation", {
      writeTraceSuggestion: passThroughMiddleware,
    }),
    bugReportPorts: stub("bugReports"),
    dataPrivacyPorts: stub("dataPrivacy"),
    integrationsChecksPorts: stub("integrationsChecks"),
    traceCommands: stub("product.traceCommands"),
  });
}


export function stubOrgGroupHalf(): ApiOrgGroupCollaborators {
  return stub<ApiOrgGroupCollaborators>("orgGroup", {
    application: {
      automation: stub("app.automation"),
      codingAgentApp: stub("app.codingAgentApp"),
      licensing: stub("app.licensing"),
      projects: stub("app.projects", { getOrganizationId: async () => "organization-1" }),
      scimApp: stub("app.scimApp"),
      usageLimits: stub("app.usageLimits"),
    },
    organization: stub("organization", {
      signUpDataSchema: anySchema,
      isCustomRole: () => false,
    }),
    organizationAuditLogCheck: passThroughMiddleware,
    project: stub("project"),
    projectChecks: {
      create: passThroughMiddleware,
      traceSharing: passThroughMiddleware,
    },
    codingAgents: stub("codingAgents"),
    automation: stub("automation", { providers: stub("automation.providers") }),
    emailSuppression: stub("emailSuppression"),
    enterprise: {
      scimToken: stub("enterprise.scimToken"),
      ssoConnections: stub("enterprise.ssoConnections"),
    },
  });
}

/**
 * The `ctx.app` slices no half owns any more, as a suite that drives none of
 * them supplies them: the gateway's application, the GitHub directory and the
 * four Enterprise governance slices, each refusing by name if a call reaches it.
 */
export function stubApplicationSlices(): ApiTrpcFeatureApplicationSlices {
  return {
    gateway: stub("app.gateway"),
    github: stub("app.github"),
    analytics: stub("app.analytics"),
    dashboard: stub("app.dashboard"),
    langy: stub("app.langy"),
    monitors: stub("app.monitors"),
    scenarios: stub("app.scenarios"),
    storedObjectApp: stub("app.storedObjectApp"),
    suites: stub("app.suites"),
    // Answers rather than refuses: several namespaces that are NOT the surface
    // under test still gate on `ctx.app.ops.isAdmin()` at call time.
    ops: stub("app.ops", { isAdmin: () => true }),
    governance: stub("app.governance"),
    governanceApp: stub("app.governanceApp"),
    sessionPolicy: stub("app.sessionPolicy"),
    webhooks: stub("app.webhooks"),
  };
}

/**
 * The features composed ahead of the mount, as a suite that drives another one
 * supplies them: the namespaces build on the real parsers and every call
 * refuses.
 */
export function stubComposedFeatures(): ComposedApiFeatures {
  return {
    gateway: {
      app: stub("app.gateway", { schemas: { virtualKeyBudgetInput: anySchema } }),
      composition: undefined,
      router: (mount) =>
        createGatewayTrpcRouters({
          ...mount,
          ports: { virtualKeys: { virtualKeyBudgetInput: anySchema } },
        }),
    },
    langy: refusingLangyFeature(),
    ops: refusingOpsFeature(),
    scenario: refusingScenarioFeature(),
    analytics: refusingAnalyticsFeature(),
    dataRetention: refusingDataRetentionFeature(),
    monitor: refusingMonitorFeature(),
    storedObject: refusingStoredObjectFeature(),
  };
}

/**
 * All ten halves, stubbed by default. Pass the half(s) a test actually
 * composes as overrides — the rest stay stubbed so the full record still
 * builds. `broadcast` seeds the identity half's tenant emitter; give it the
 * same `EventEmitter` a subscription test emits on.
 */
export function testHalves(
  overrides: Partial<ApiTrpcCollaboratorHalves> = {},
  broadcast: EventEmitter = new EventEmitter(),
): ApiTrpcCollaboratorHalves {
  return {
    product: stubProductHalf(),
    identity: stubIdentityHalf(broadcast),
    execution: stubExecutionHalf(),
    productGroup: stubProductGroupHalf(),
    traceGroup: stubTraceGroupHalf(),
    orgGroup: stubOrgGroupHalf(),
    ...overrides,
  };
}
