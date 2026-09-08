/**
 * The process's whole tRPC feature record, built with every port refusing.
 *
 * Two tests read it: the one list, and the authz declaration sweep. Both need
 * the application's OWN root and the real parsers, so the record is built here
 * once rather than shaped by hand twice.
 */

import {
  createIsPublicProcedure,
  createTrpcRuntime,
  type AppTrpcPolicyMiddlewares,
  type TrpcRuntimePorts,
} from "@langwatch/api/trpc";

import { declareAuthzMiddleware } from "@langwatch/authz-contract";

import { createTrpcRoot, type ApiTrpcContext } from "../../../api.application.ts";
import { composeGatewayFeature } from "../../../features/gateway/gateway.composition.ts";
import { refusingAuthFeature } from "../../../features/auth/auth.composition.ts";
import { refusingUserFeature } from "../../../features/user/user.composition.ts";
import {
  stubDashboardFeature,
  stubEvaluationFeature,
  stubMonitorFeature,
  stubRoleFeature,
  stubStoredObjectFeature,
  stubDataPrivacyFeature,
  stubDataRetentionFeature,
  stubEntitlementFeature,
  stubFeatureFlagFeature,
  stubPresenceFeature,
  stubSecretFeature,
  stubShareFeature,
  stubTopicFeature,
} from "../../../app/__tests__/api-trpc-record.test-doubles.ts";
import { refusingApiKeyFeature } from "../../../features/api-key/api-key.composition.ts";
import { refusingLangyFeature } from "../../../features/langy/langy.composition.ts";
import { refusingAnalyticsFeature } from "../../../features/analytics/analytics.composition.ts";
import { refusingDatasetFeature } from "../../../features/dataset/dataset.composition.ts";
import { refusingEvaluatorFeature } from "../../../features/evaluator/evaluator.composition.ts";
import { refusingPromptFeature } from "../../../features/prompt/prompt.composition.ts";
import { refusingHomeFeature } from "../../../features/project/home.composition.ts";
import { refusingScenarioFeature } from "../../../features/scenario/scenario.composition.ts";
import { refusingBugReportFeature } from "../../../features/bug-report/bug-report.composition.ts";
import { refusingIntegrationsChecksFeature } from "../../../features/project/integrations-checks.composition.ts";
import { refusingAnnotationFeature } from "../../../features/annotation/annotation-absence.ts";
import { refusingHttpProxyFeature } from "../../../features/agent/http-proxy.composition.ts";
import { refusingModelProviderFeature } from "../../../features/model-provider/model-provider.composition.ts";
import { refusingTraceFeature } from "../../../features/trace/trace.composition.ts";
import { refusingWorkflowFeature } from "../../../features/workflow/workflow.composition.ts";
import { refusingExperimentFeature } from "../../../features/experiment/experiment.composition.ts";
import { refusingOrganizationFeature } from "../../../features/organization/organization.composition.ts";
import { refusingProjectFeature } from "../../../features/project/project.composition.ts";
import { refusingCodingAgentFeature } from "../../../features/coding-agent/coding-agent.composition.ts";
import { refusingAutomationFeature } from "../../../features/automation/automation.composition.ts";
import { refusingEnterpriseFeature } from "../../../features/enterprise/enterprise.composition.ts";
import { refusingOpsFeature } from "../../../features/ops/ops.composition.ts";
import { createAppTrpcFeatures } from "../../app-trpc.features.ts";

/** Every member refuses, so reaching one while BUILDING a surface is a failure. */
const refuseEveryMember = (what: string) =>
  new Proxy(
    {},
    {
      get: (_target, member) => (): never => {
        throw new Error(`${what}.${String(member)} was reached while building the feature list`);
      },
    },
  ) as never;

/** A pass-through stand-in for one of the process's policy middlewares. */
const passThrough =
  () =>
  ({ next }: { next: () => Promise<unknown> }) =>
    next();

const middlewares: AppTrpcPolicyMiddlewares = {
  tracer: passThrough(),
  logger: passThrough(),
  handledError: passThrough(),
  scopeLineageGuard: () => passThrough(),
  // The real one attaches the declaration to the middleware it builds, which
  // is what the declaration sweep reads back off a mounted procedure.
  declaredCheck: (declaration) =>
    declareAuthzMiddleware(
      declaration,
      passThrough() as unknown as (params: never) => Promise<unknown>,
    ),
  enforceCheck: passThrough(),
  auditMutations: passThrough(),
};

/**
 * The declared path's ports, permissive for the same reason the middlewares
 * above are: the record is being enumerated, not exercised.
 */
const runtimePorts: TrpcRuntimePorts<ApiTrpcContext> = {
  identity: { caller: () => ({ actor: { type: "user", id: "builder" } }) },
  authorization: {
    forRequest: () => ({
      getDecision: async () => ({ permitted: true, organizationRole: null }),
      getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
      checkScopeLineage: async () => ({ kind: "consistent" }),
    }),
  },
  denials: {
    membershipDisabled: () => new Error("membership disabled"),
    liteMemberRestricted: () => new Error("lite member"),
  },
  audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
  errors: {
    report: () => {},
    asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
    translate: () => undefined,
  },
};

/**
 * The mount the record is built against. `authenticate` gives the authenticated
 * procedure a middleware, which is what makes one built on the public procedure
 * distinguishable — the only way to enumerate the anonymous surface.
 */
export function buildAppTrpcMount(options: { authenticate?: boolean } = {}) {
  // The application's OWN root, not a second one shaped by hand: the record is
  // typed against `ApiTrpcFeatureMount`, so a hand-rolled root would prove
  // something other than what the process mounts.
  const trpc = createTrpcRoot();
  const authentication = passThrough();

  const mount = {
    root: trpc,
    protectedProcedure: options.authenticate
      ? trpc.procedure.use(authentication as never)
      : trpc.procedure,
    publicProcedure: trpc.procedure,
    middlewares,
    runtime: createTrpcRuntime<ApiTrpcContext>({
      root: trpc,
      procedure: options.authenticate
        ? trpc.procedure.use(authentication as never)
        : trpc.procedure,
      ports: runtimePorts,
    }),
    // Test processes check every declared output: a shape that drifted from
    // its schema is a defect, and this is where it is cheap to find.
    validateOutput: true,
  };

  return {
    trpc,
    mount,
    isPublicProcedure: createIsPublicProcedure(trpc.middleware(authentication as never)),
  };
}

export function buildAppTrpcFeatures(
  mount: ReturnType<typeof buildAppTrpcMount>["mount"] = buildAppTrpcMount().mount,
) {
  return createAppTrpcFeatures({
    mount,
    // The features whose doors are not only tRPC, composed before the mount
    // existed. The gateway's application refuses like every port below; its
    // PARSERS are real, because a procedure cannot be built without them.
    composed: {
      gateway: composeGatewayFeature({
        infrastructure: undefined,
        peers: undefined,
        clickhouse: null,
        virtualKeyPepper: undefined,
      }),
      auth: refusingAuthFeature("langwatch-api"),
      user: refusingUserFeature("langwatch-api"),
      presence: stubPresenceFeature(),
      apiKey: refusingApiKeyFeature(),
      langy: refusingLangyFeature(),
      ops: refusingOpsFeature(),
      scenario: refusingScenarioFeature(),
      analytics: refusingAnalyticsFeature(),
      featureFlag: stubFeatureFlagFeature(),
      dataset: refusingDatasetFeature(),
      evaluator: refusingEvaluatorFeature(),
      prompt: refusingPromptFeature(),
      dataRetention: stubDataRetentionFeature(),
      monitor: stubMonitorFeature(),
      home: refusingHomeFeature(),
      role: stubRoleFeature(),
      storedObject: stubStoredObjectFeature(),
      bugReport: refusingBugReportFeature(),
      dataPrivacy: stubDataPrivacyFeature(),
      integrationsChecks: refusingIntegrationsChecksFeature(),
      annotation: refusingAnnotationFeature(),
      dashboard: stubDashboardFeature(),
      entitlement: stubEntitlementFeature(),
      httpProxy: refusingHttpProxyFeature(),
      modelProvider: refusingModelProviderFeature(),
      share: stubShareFeature(),
      topic: stubTopicFeature(),
      trace: refusingTraceFeature(),
      workflow: refusingWorkflowFeature(),
      experiment: refusingExperimentFeature(),
      evaluation: stubEvaluationFeature(),
      organization: refusingOrganizationFeature(),
      project: refusingProjectFeature(),
      codingAgent: refusingCodingAgentFeature(),
      automation: refusingAutomationFeature(),
      enterprise: refusingEnterpriseFeature(),
      secret: stubSecretFeature(),
    },
    // The features that compose themselves take this rather than a ports
    // entry; every member refuses, for the same reason the ports do.
    infrastructure: {
      prisma: refuseEveryMember("infrastructure.prisma"),
      authz: refuseEveryMember("infrastructure.authz"),
      plans: refuseEveryMember("infrastructure.plans"),
      featureFlags: refuseEveryMember("infrastructure.featureFlags"),
      auditLog: refuseEveryMember("infrastructure.auditLog"),
      // The hosted product, so both Enterprise billing namespaces carry their
      // procedures — which is what the lists below read them for.
      saasBilling: true,
      audit: undefined,
    },
  });
}
