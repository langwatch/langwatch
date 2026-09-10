/**
 * Stub builders for the features an integration test is NOT exercising, plus the shared
 * `stub()` proxy every one of those tests already used to fake a namespace's build-time
 * surface.
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { EventEmitter } from "node:events";
import { z } from "zod";
import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import type { ApiTrpcCollaborators } from "../../app-trpc/app-trpc.collaborators.ts";
import type { ApiTrpcFeatureApplicationSlices } from "../api-trpc-features.composition.ts";
import { createGatewayTrpcRouters } from "../../features/gateway/gateway-trpc.mount.ts";
import { refusingLangyFeature } from "../../features/langy/langy.composition.ts";
import type { ComposedOpsFeature } from "../../features/ops/ops.composition.types.ts";
import { refusingAnalyticsFeature } from "../../features/analytics/analytics.composition.ts";
import { refusingDatasetFeature } from "../../features/dataset/dataset.composition.ts";
import { createEvaluatorTrpcRouter } from "../../features/evaluator/evaluator-trpc.mount.ts";
import type { ComposedEvaluatorFeature } from "../../features/evaluator/evaluator.composition.types.ts";
import { refusingPromptFeature } from "../../features/prompt/prompt.composition.ts";
import { createFeatureFlagTrpcRouter } from "../../features/feature-flag/feature-flag-trpc.mount.ts";
import type { ComposedFeatureFlagFeature } from "../../features/feature-flag/feature-flag.composition.types.ts";
import { createDataRetentionTrpcRouter } from "../../features/data-retention/data-retention-trpc.mount.ts";
import type { ComposedDataRetentionFeature } from "../../features/data-retention/data-retention.composition.types.ts";
import { createMonitorTrpcRouter } from "../../features/monitor/monitor-trpc.mount.ts";
import { refusingHomeFeature } from "../../features/project/home.composition.ts";
import { createRoleBindingTrpcRouter, createRoleTrpcRouter } from "../../features/role/role-trpc.mount.ts";
import { refusingScenarioFeature } from "../../features/scenario/scenario.composition.ts";
import { createStoredObjectTrpcRouter } from "../../features/stored-object/stored-object-trpc.mount.ts";
import { refusingAnnotationFeature } from "../../features/annotation/annotation-absence.ts";
import {
  createDashboardTrpcRouter,
  createGraphTrpcRouter,
  createSavedViewTrpcRouter,
  createSavedWorkbenchChartTrpcRouter,
} from "../../features/dashboard/dashboard-trpc.mount.ts";
import {
  createOrganizationSpendTrpcRouter,
  createPlanTrpcRouter,
  createUsageLimitsTrpcRouter,
} from "../../features/entitlement/entitlement-trpc.mount.ts";
import type { ComposedEntitlementFeature } from "../../features/entitlement/entitlement.composition.types.ts";
import { refusingHttpProxyFeature } from "../../features/agent/http-proxy.composition.ts";
import { refusingModelProviderFeature } from "../../features/model-provider/model-provider.composition.ts";
import {
  createPinnedTraceTrpcRouter,
  createShareTrpcRouter,
} from "../../features/share/share-trpc.mount.ts";
import type { ComposedShareFeature } from "../../features/share/share.composition.types.ts";
import { createTopicTrpcRouter } from "../../features/topic/topic-trpc.mount.ts";
import type { ComposedTopicFeature } from "../../features/topic/topic.composition.types.ts";
import { refusingTraceFeature } from "../../features/trace/trace.composition.ts";
import { createDataPrivacyTrpcRouter } from "../../features/data-privacy/data-privacy-trpc.mount.ts";
import type { ComposedDataPrivacyFeature } from "../../features/data-privacy/data-privacy.composition.types.ts";
import type { ComposedDashboardFeature } from "../../features/dashboard/dashboard.composition.types.ts";
import type { ComposedEvaluationFeature } from "../../features/evaluation/evaluation.composition.types.ts";
import type { ComposedMonitorFeature } from "../../features/monitor/monitor.composition.types.ts";
import type { ComposedRoleFeature } from "../../features/role/role.composition.types.ts";
import type { ComposedStoredObjectFeature } from "../../features/stored-object/stored-object.composition.types.ts";
import { refusingIntegrationsChecksFeature } from "../../features/project/integrations-checks.composition.ts";
import { refusingWorkflowFeature } from "../../features/workflow/workflow.composition.ts";
import { refusingExperimentFeature } from "../../features/experiment/experiment.composition.ts";
import { createEvaluationTrpcRouter } from "../../features/evaluation/evaluation-trpc.mount.ts";
import { refusingOrganizationFeature } from "../../features/organization/organization.composition.ts";
import { refusingProjectFeature } from "../../features/project/project.composition.ts";
import { CodingAgentApp } from "@langwatch/coding-agent-server";
import { createCodingAgentTrpcRouter } from "../../features/coding-agent/coding-agent-trpc.mount.ts";
import { refusingAutomationFeature } from "../../features/automation/automation.composition.ts";
import { refusingEnterpriseFeature } from "../../features/enterprise/enterprise.composition.ts";
import { composeAuthFeature } from "../../features/auth/auth.composition.ts";
import { testAuthApi } from "../../features/auth/__tests__/support/test-auth-api.ts";
import { refusingUserFeature } from "../../features/user/user.composition.ts";
import { createPresenceTrpcRouter } from "../../features/presence/presence-trpc.mount.ts";
import type { ComposedPresenceFeature } from "../../features/presence/presence.composition.types.ts";
import { createApiKeyTrpcRouter } from "../../features/api-key/api-key-trpc.mount.ts";
import type { ComposedApiKeyFeature } from "../../features/api-key/api-key.composition.types.ts";
import { createSecretTrpcRouter } from "../../features/secret/secret-trpc.mount.ts";
import type { ComposedSecretFeature } from "../../features/secret/secret.composition.types.ts";
import type { ComposedApiFeatures } from "../../app-trpc/app-trpc.composed.ts";

const anySchema = z.any();

/**
 * A collaborator surface with only the members the record reads while it is being BUILT.
 * Everything else answers a function that refuses by name if a call actually reaches it —
 * a stub is a promise about what a test drives, not a full fake.
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
 * The plan lookup and the flag store the record's own compositions read, as a suite that
 * drives neither supplies them: every organization is on the free plan and inside every
 * rollout, so a feature gated on either still MOUNTS and a suite asserting on the gate
 */
export function stubInfrastructureEntitlements(): Pick<
  ApiTrpcInfrastructure,
  "plans" | "featureFlags" | "saasBilling" | "auditLog"
> {
  return {
    auditLog: createApiFixture<AuditLogApi>({
      record: async () => void 0,
      listEntityHistory: async () => [],
    }),
    plans: { getActivePlan: async () => ({ type: "FREE" }) as never },
    featureFlags: stub("featureFlags", { isEnabled: async () => true }),
    // Self-hosted, so the two Enterprise billing namespaces mount as the empty
    // routers of the same served type. A suite asserting on billing overrides it.
    saasBilling: false,
  };
}

/**
 * The whole `ctx.app` application, as a suite that drives none of it supplies it: every
 * slice refuses by name if a call reaches it, except the handful that surfaces which are
 * @param broadcast The tenant fan-out `ctx.app.broadcast.getTenantEmitter()`
 */
export function stubApplicationSlices(
  broadcast: EventEmitter = new EventEmitter(),
): ApiTrpcFeatureApplicationSlices {
  return {
    apiKeys: stub("app.apiKeys"),
    broadcast: {
      getTenantEmitter: () => broadcast,
      cleanupTenantEmitter: () => undefined,
    } as ApiTrpcFeatureApplicationSlices["broadcast"],
    config: {},
    organizations: stub("app.organizations"),
    presence: stub("app.presence"),
    users: stub("app.users"),
    gateway: stub("app.gateway"),
    github: stub("app.github"),
    analytics: stub("app.analytics"),
    modelProviders: stub("app.modelProviders"),
    dataRetention: stub("app.dataRetention"),
    planProvider: stub("app.planProvider", { getActivePlan: async () => ({ type: "FREE" }) }),
    share: stub("app.share"),
    topics: stub("app.topics"),
    dataPrivacy: stub("app.dataPrivacy"),
    sso: stub("app.sso"),
    traces: stub("app.traces"),
    workflows: stub("app.workflows"),
    experiments: stub("app.experiments"),
    evaluations: stub("app.evaluations"),
    annotation: stub("app.annotation"),
    authzApp: stub("app.authzApp"),
    permissions: stub("app.permissions"),
    roles: stub("app.roles"),
    dashboard: stub("app.dashboard"),
    dataset: stub("app.dataset"),
    evaluatorApp: stub("app.evaluatorApp"),
    featureFlags: stub("app.featureFlags", { isEnabled: async () => true }),
    featureFlag: createApiFixture<ApiTrpcFeatureApplicationSlices["featureFlag"]>(
      { isEnabled: async () => false },
      "app.featureFlag",
    ),
    secrets: stub("app.secrets"),
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
 * The three features with no refusing twin. Each mounts its real parsers over a
 * stub application, which is what a refusal used to be: the namespace is on the
 * record and every call through it refuses by name.
 */
export function stubEntitlementFeature(): ComposedEntitlementFeature {
  const app = stub<ComposedEntitlementFeature["app"]>("entitlement");
  return {
    app,
    routers: (mount) => ({
      plan: createPlanTrpcRouter(mount.runtime, app),
      limits: createUsageLimitsTrpcRouter(mount.runtime, app),
      costs: createOrganizationSpendTrpcRouter(mount.runtime, app),
    }),
  };
}

export function stubShareFeature(): ComposedShareFeature {
  return {
    app: stub("share"),
    routers: (mount) => ({
      share: createShareTrpcRouter(mount.runtime),
      pinnedTrace: createPinnedTraceTrpcRouter(mount.runtime),
    }),
  };
}

export function stubPresenceFeature(): ComposedPresenceFeature {
  return {
    app: stub("presence"),
    emitter: stub("presence.emitter"),
    broadcast: stub("presence.broadcast"),
    router: (mount) => createPresenceTrpcRouter(mount.runtime),
  };
}

export function stubFeatureFlagFeature(): ComposedFeatureFlagFeature {
  return {
    app: createApiFixture<ComposedFeatureFlagFeature["app"]>(
      { isEnabled: async () => false },
      "featureFlag",
    ),
    router: (mount) => createFeatureFlagTrpcRouter(mount.runtime),
  };
}

export function stubDataRetentionFeature(): ComposedDataRetentionFeature {
  return {
    service: createApiFixture<ComposedDataRetentionFeature["service"]>({}, "dataRetention"),
    router: (mount) => createDataRetentionTrpcRouter(mount.runtime),
  };
}

export function stubApiKeyFeature(): ComposedApiKeyFeature {
  return {
    app: stub("apiKeys"),
    router: (mount) =>
      createApiKeyTrpcRouter({ runtime: mount.runtime, recordAudit: () => undefined }),
  };
}

export function stubTopicFeature(): ComposedTopicFeature {
  return {
    app: stub("topic"),
    router: (mount) => createTopicTrpcRouter(mount.runtime),
  };
}

/**
 * The five features whose door landed: every namespace builds on the real
 * declaration and every application call refuses by name.
 */
export function stubDashboardFeature(): ComposedDashboardFeature {
  const app = stub<ComposedDashboardFeature["app"]>("dashboard");
  return {
    routers: (mount) => ({
      dashboards: createDashboardTrpcRouter(mount.runtime),
      graphs: createGraphTrpcRouter(mount.runtime),
      savedViews: createSavedViewTrpcRouter(mount.runtime),
      savedWorkbenchCharts: createSavedWorkbenchChartTrpcRouter(mount.runtime),
    }),
    app,
    restServices: { dashboard: () => app },
  };
}

export function stubEvaluationFeature(): ComposedEvaluationFeature {
  return {
    routers: (mount) => ({ evaluations: createEvaluationTrpcRouter(mount.runtime) }),
    app: stub("evaluations"),
    reportEvaluation: () => Promise.reject(new Error("evaluations.reportEvaluation")),
  };
}

export function stubMonitorFeature(): ComposedMonitorFeature {
  const app = stub<ComposedMonitorFeature["app"]>("monitors");
  return {
    routers: (mount) => ({ monitors: createMonitorTrpcRouter(mount.runtime) }),
    app,
    restServices: { monitors: () => app },
  };
}

export function stubEvaluatorFeature(): ComposedEvaluatorFeature {
  const app = stub<ComposedEvaluatorFeature["app"]>("evaluators");
  return {
    router: (mount) => createEvaluatorTrpcRouter(mount.runtime),
    app,
    evaluators: stub("evaluators.runtime"),
    restServices: { evaluators: () => app },
  };
}

export function stubRoleFeature(): ComposedRoleFeature {
  return {
    routers: (mount) => ({
      role: createRoleTrpcRouter(mount.runtime),
      roleBinding: createRoleBindingTrpcRouter(mount.runtime),
    }),
    app: stub("roles"),
  };
}

export function stubStoredObjectFeature(): ComposedStoredObjectFeature {
  return {
    router: (mount) => createStoredObjectTrpcRouter(mount.runtime),
    app: stub("storedObjectApp"),
    restServices: { storedObjects: () => stub("storedObjects") },
    bytes: stub("storedObjects.bytes"),
    payloadStaging: stub("storedObjects.payloadStaging"),
    storage: { runtime: stub("storedObjects.storage"), aws: stub("storedObjects.aws") },
    close: () => Promise.resolve(),
  };
}

export function stubDataPrivacyFeature(): ComposedDataPrivacyFeature {
  return {
    app: stub("dataPrivacy"),
    router: (mount) => createDataPrivacyTrpcRouter(mount.runtime),
  };
}

export function stubSecretFeature(): ComposedSecretFeature {
  return {
    app: createApiFixture<ComposedSecretFeature["app"]>({}, "secrets"),
    rest: [],
    routers: (mount) => ({ secrets: createSecretTrpcRouter(mount.runtime) }),
  };
}

/**
 * The record's collaborators: the whole stubbed application, with the slices a suite
 * actually drives passed as overrides.
 * @param broadcast see {@link stubApplicationSlices}.
 */
export function stubCollaborators(
  overrides: Partial<ApiTrpcFeatureApplicationSlices> = {},
  broadcast: EventEmitter = new EventEmitter(),
): ApiTrpcCollaborators {
  return { application: { ...stubApplicationSlices(broadcast), ...overrides } };
}

/**
 * The features composed ahead of the mount, as a suite that drives another one
 * supplies them: the namespaces build on the real parsers and every call
 * refuses.
 */
/**
 * The operator slice a suite that drives no back office supplies. The API
 * process either installs the module or fails boot by name, so the absence is
 * a test's own, not a deployment shape.
 */
export function stubOpsFeature(): ComposedOpsFeature {
  return { app: stub("app.ops") };
}

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
    ops: stubOpsFeature(),
    scenario: refusingScenarioFeature(),
    analytics: refusingAnalyticsFeature(),
    featureFlag: stubFeatureFlagFeature(),
    dataset: refusingDatasetFeature(),
    evaluator: stubEvaluatorFeature(),
    prompt: refusingPromptFeature(),
    dataRetention: stubDataRetentionFeature(),
    workflow: refusingWorkflowFeature(),
    experiment: refusingExperimentFeature(),
    evaluation: stubEvaluationFeature(),
    monitor: stubMonitorFeature(),
    home: refusingHomeFeature(),
    role: stubRoleFeature(),
    storedObject: stubStoredObjectFeature(),
    annotation: refusingAnnotationFeature(),
    dashboard: stubDashboardFeature(),
    entitlement: stubEntitlementFeature(),
    httpProxy: refusingHttpProxyFeature(),
    modelProvider: refusingModelProviderFeature(),
    share: stubShareFeature(),
    topic: stubTopicFeature(),
    trace: refusingTraceFeature(),
    dataPrivacy: stubDataPrivacyFeature(),
    integrationsChecks: refusingIntegrationsChecksFeature(),
    organization: refusingOrganizationFeature(),
    project: refusingProjectFeature(),
    codingAgent: {
      app: CodingAgentApp.refusing(),
      router: (mount) => createCodingAgentTrpcRouter(mount.runtime),
    },
    automation: refusingAutomationFeature(),
    enterprise: refusingEnterpriseFeature(),
    auth: composeAuthFeature(testAuthApi()),
    user: refusingUserFeature("langwatch-api"),
    presence: stubPresenceFeature(),
    apiKey: stubApiKeyFeature(),
    secret: stubSecretFeature(),
  };
}

/**
 * The mount a record is built on, for the structural assertions that ask what a record
 * CONTAINS rather than what it answers. The mount only has to be constructible: every
 * procedure builder below returns itself, which is what a chain of decorators expects.
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
  // The declared path, structurally: building through it is what a
  // declaration-mounted feature (annotation, apiKey) does — one `procedure`
  // call per member, then the record collected through `router`.
  const runtime = {
    procedure: () => chain,
    router: (routes: Record<string, unknown>) => root.router(routes),
  };
  const declaredRuntime = {
    ...runtime,
    mount: (
      declaration: {
        router: (factory: typeof runtime, app: (ctx: never) => unknown) => unknown;
      },
      app: (ctx: never) => unknown,
    ) => declaration.router(runtime, app),
  };
  return {
    root,
    protectedProcedure: chain,
    publicProcedure: chain,
    runtime: declaredRuntime,
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
