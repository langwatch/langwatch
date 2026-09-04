/**
 * Stub builders for the collaborators and features an integration test is NOT
 * exercising, plus the shared `stub()` proxy every one of those tests already
 * used to fake a namespace's build-time surface.
 *
 * Each composition integration test composes the REAL feature its file names
 * and needs the rest only well enough for
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
import { createGatewayTrpcRouters } from "../../features/gateway/gateway-trpc.mount";
import { refusingLangyFeature } from "../../features/langy/langy.composition";
import { refusingOpsFeature } from "../../features/ops/ops.composition";
import { refusingAnalyticsFeature } from "../../features/analytics/analytics.composition";
import { refusingDatasetFeature } from "../../features/dataset/dataset.composition";
import { refusingEvaluatorFeature } from "../../features/evaluator/evaluator.composition";
import { refusingPromptFeature } from "../../features/prompt/prompt.composition";
import { refusingFeatureFlagFeature } from "../../features/feature-flag/feature-flag.composition";
import { refusingDataRetentionFeature } from "../../features/data-retention/data-retention.composition";
import { refusingMonitorFeature } from "../../features/monitor/monitor.composition";
import { refusingHomeFeature } from "../../features/project/home.composition";
import { refusingRoleFeature } from "../../features/role/role.composition";
import { refusingScenarioFeature } from "../../features/scenario/scenario.composition";
import { refusingStoredObjectFeature } from "../../features/stored-object/stored-object.composition";
import { refusingBugReportFeature } from "../../features/bug-report/bug-report.composition";
import { refusingAnnotationFeature } from "../../features/annotation/annotation.composition";
import { refusingSavedViewFeature } from "../../features/dashboard/saved-view.composition";
import { refusingSpendFeature } from "../../features/entitlement/spend.composition";
import { refusingHttpProxyFeature } from "../../features/agent/http-proxy.composition";
import { refusingModelProviderFeature } from "../../features/model-provider/model-provider.composition";
import { refusingShareFeature } from "../../features/share/share.composition";
import { refusingTopicFeature } from "../../features/topic/topic.composition";
import { refusingTraceFeature } from "../../features/trace/trace.composition";
import { refusingDataPrivacyFeature } from "../../features/data-privacy/data-privacy.composition";
import { refusingIntegrationsChecksFeature } from "../../features/project/integrations-checks.composition";
import { refusingWorkflowFeature } from "../../features/workflow/workflow.composition";
import { refusingExperimentFeature } from "../../features/experiment/experiment.composition";
import { refusingEvaluationFeature } from "../../features/evaluation/evaluation.composition";
import { refusingOrganizationFeature } from "../../features/organization/organization.composition";
import { refusingProjectFeature } from "../../features/project/project.composition";
import { refusingCodingAgentFeature } from "../../features/coding-agent/coding-agent.composition";
import { refusingAutomationFeature } from "../../features/automation/automation.composition";
import { refusingEnterpriseFeature } from "../../features/enterprise/enterprise.composition";
import type { ComposedApiFeatures } from "../../app-trpc/app-trpc.composed";
import type { ApiIdentityCollaborators } from "../api-trpc-collaborators.identity.composition";

const anySchema = z.any();

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
    modelProviders: stub("app.modelProviders"),
    dataRetention: stub("app.dataRetention"),
    planProvider: stub("app.planProvider", { getActivePlan: async () => ({ type: "FREE" }) }),
    share: stub("app.share"),
    topics: stub("app.topics"),
    traces: stub("app.traces"),
    workflows: stub("app.workflows"),
    experiments: stub("app.experiments"),
    evaluations: stub("app.evaluations"),
    annotations: stub("app.annotations"),
    authzApp: stub("app.authzApp"),
    permissions: stub("app.permissions"),
    roles: stub("app.roles"),
    dashboard: stub("app.dashboard"),
    dataset: stub("app.dataset"),
    evaluatorApp: stub("app.evaluatorApp"),
    featureFlags: stub("app.featureFlags", { isEnabled: async () => true }),
    langy: stub("app.langy"),
    monitors: stub("app.monitors"),
    scenarios: stub("app.scenarios"),
    storedObjectApp: stub("app.storedObjectApp"),
    suites: stub("app.suites"),
    automation: stub("app.automation"),
    codingAgentApp: stub("app.codingAgentApp"),
    licensing: stub("app.licensing"),
    projects: stub("app.projects", { getOrganizationId: async () => "organization-1" }),
    scimApp: stub("app.scimApp"),
    usageLimits: stub("app.usageLimits"),
    // Answers rather than refuses: several namespaces that are NOT the surface
    // under test still gate on `ctx.app.ops.isAdmin()` at call time.
    ops: stub("app.ops", { isAdmin: () => true }),
    prompts: stub("app.prompts"),
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
    featureFlag: refusingFeatureFlagFeature(),
    dataset: refusingDatasetFeature(),
    evaluator: refusingEvaluatorFeature(),
    prompt: refusingPromptFeature(),
    dataRetention: refusingDataRetentionFeature(),
    workflow: refusingWorkflowFeature(),
    experiment: refusingExperimentFeature(),
    evaluation: refusingEvaluationFeature(),
    monitor: refusingMonitorFeature(),
    home: refusingHomeFeature(),
    role: refusingRoleFeature(),
    storedObject: refusingStoredObjectFeature(),
    bugReport: refusingBugReportFeature(),
    annotation: refusingAnnotationFeature(),
    savedView: refusingSavedViewFeature(),
    spend: refusingSpendFeature(),
    httpProxy: refusingHttpProxyFeature(),
    modelProvider: refusingModelProviderFeature(),
    share: refusingShareFeature(),
    topic: refusingTopicFeature(),
    trace: refusingTraceFeature(),
    dataPrivacy: refusingDataPrivacyFeature(),
    integrationsChecks: refusingIntegrationsChecksFeature(),
    organization: refusingOrganizationFeature(),
    project: refusingProjectFeature(),
    codingAgent: refusingCodingAgentFeature(),
    automation: refusingAutomationFeature(),
    enterprise: refusingEnterpriseFeature(),
  };
}

/**
 * The remaining half, stubbed by default. Pass it as an override where a test
 * actually composes it — otherwise it stays stubbed so the full record still
 * builds. `broadcast` seeds the identity half's tenant emitter; give it the
 * same `EventEmitter` a subscription test emits on.
 */
export function testHalves(
  overrides: Partial<ApiTrpcCollaboratorHalves> = {},
  broadcast: EventEmitter = new EventEmitter(),
): ApiTrpcCollaboratorHalves {
  return {
    identity: stubIdentityHalf(broadcast),
    ...overrides,
  };
}

/**
 * The mount a record is built on, for the structural assertions that ask what
 * a record CONTAINS rather than what it answers.
 *
 * The mount only has to be constructible: every procedure builder below
 * returns itself, which is what a chain of decorators expects.
 */
export function stubMount(): never {
  const procedure: Record<string, unknown> = {};
  const chain = new Proxy(procedure, {
    get: (_target, property) => {
      if (property === "_def") return {};
      return () => chain;
    },
  });
  const root = {
    // `_def.procedures` as well as the routes themselves: a real tRPC router
    // carries both, and the surfaces that merge sub-routers flat — the scenario
    // and suite transports — read the routes back off `_def`.
    router: (routes: Record<string, unknown>) =>
      Object.assign({}, routes, { _def: { procedures: routes } }),
    mergeRouters: (...routers: Array<Record<string, unknown>>) =>
      Object.assign({}, ...routers) as Record<string, unknown>,
    procedure: chain,
  };
  return {
    root,
    protectedProcedure: chain,
    publicProcedure: chain,
    // Every middleware answers a callable that yields a middleware object. The
    // chain above swallows whatever `.use()` is handed, so what a middleware IS
    // does not matter here — only that naming one never throws.
    middlewares: new Proxy(
      {},
      {
        get: () => {
          const middleware = () => middleware;
          return middleware;
        },
      },
    ),
  } as never;
}
