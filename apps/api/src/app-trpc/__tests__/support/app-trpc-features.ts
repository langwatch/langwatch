/**
 * The process's whole tRPC feature record, built with every port refusing.
 *
 * Two tests read it: the one list, and the authz declaration sweep. Both need
 * the application's OWN root and the real parsers, so the record is built here
 * once rather than shaped by hand twice.
 */

import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";

import { declareAuthzMiddleware } from "@langwatch/authz-contract";

import { createTrpcRoot } from "../../../api.application";
import { composeGatewayFeature } from "../../../features/gateway/gateway.composition";
import { refusingAuthFeature } from "../../../features/auth/auth.composition";
import { refusingUserFeature } from "../../../features/user/user.composition";
import { refusingPresenceFeature } from "../../../features/presence/presence.composition";
import { refusingApiKeyFeature } from "../../../features/api-key/api-key.composition";
import { refusingLangyFeature } from "../../../features/langy/langy.composition";
import { refusingDataRetentionFeature } from "../../../features/data-retention/data-retention.composition";
import { refusingAnalyticsFeature } from "../../../features/analytics/analytics.composition";
import { refusingDatasetFeature } from "../../../features/dataset/dataset.composition";
import { refusingEvaluatorFeature } from "../../../features/evaluator/evaluator.composition";
import { refusingPromptFeature } from "../../../features/prompt/prompt.composition";
import { refusingFeatureFlagFeature } from "../../../features/feature-flag/feature-flag.composition";
import { refusingMonitorFeature } from "../../../features/monitor/monitor.composition";
import { refusingHomeFeature } from "../../../features/project/home.composition";
import { refusingRoleFeature } from "../../../features/role/role.composition";
import { refusingScenarioFeature } from "../../../features/scenario/scenario.composition";
import { refusingStoredObjectFeature } from "../../../features/stored-object/stored-object.composition";
import { refusingBugReportFeature } from "../../../features/bug-report/bug-report.composition";
import { refusingDataPrivacyFeature } from "../../../features/data-privacy/data-privacy.composition";
import { refusingIntegrationsChecksFeature } from "../../../features/project/integrations-checks.composition";
import { refusingAnnotationFeature } from "../../../features/annotation/annotation.composition";
import { refusingSavedViewFeature } from "../../../features/dashboard/saved-view.composition";
import { refusingSpendFeature } from "../../../features/entitlement/spend.composition";
import { refusingHttpProxyFeature } from "../../../features/agent/http-proxy.composition";
import { refusingModelProviderFeature } from "../../../features/model-provider/model-provider.composition";
import { refusingShareFeature } from "../../../features/share/share.composition";
import { refusingTopicFeature } from "../../../features/topic/topic.composition";
import { refusingTraceFeature } from "../../../features/trace/trace.composition";
import { refusingWorkflowFeature } from "../../../features/workflow/workflow.composition";
import { refusingExperimentFeature } from "../../../features/experiment/experiment.composition";
import { refusingEvaluationFeature } from "../../../features/evaluation/evaluation.composition";
import { refusingOrganizationFeature } from "../../../features/organization/organization.composition";
import { refusingProjectFeature } from "../../../features/project/project.composition";
import { refusingCodingAgentFeature } from "../../../features/coding-agent/coding-agent.composition";
import { refusingAutomationFeature } from "../../../features/automation/automation.composition";
import { refusingEnterpriseFeature } from "../../../features/enterprise/enterprise.composition";
import { refusingOpsFeature } from "../../../features/ops/ops.composition";
import { createAppTrpcFeatures } from "../../app-trpc.features";

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

export function buildAppTrpcFeatures() {
  // The application's OWN root, not a second one shaped by hand: the record is
  // typed against `ApiTrpcFeatureMount`, so a hand-rolled root would prove
  // something other than what the process mounts.
  const trpc = createTrpcRoot();

  const mount = {
    root: trpc,
    protectedProcedure: trpc.procedure,
    publicProcedure: trpc.procedure,
    middlewares,
  };

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
      presence: refusingPresenceFeature(),
      apiKey: refusingApiKeyFeature(),
      langy: refusingLangyFeature(),
      ops: refusingOpsFeature(),
      scenario: refusingScenarioFeature(),
      analytics: refusingAnalyticsFeature(),
      featureFlag: refusingFeatureFlagFeature(),
      dataset: refusingDatasetFeature(),
      evaluator: refusingEvaluatorFeature(),
      prompt: refusingPromptFeature(),
      dataRetention: refusingDataRetentionFeature(),
      monitor: refusingMonitorFeature(),
      home: refusingHomeFeature(),
      role: refusingRoleFeature(),
      storedObject: refusingStoredObjectFeature(),
      bugReport: refusingBugReportFeature(),
      dataPrivacy: refusingDataPrivacyFeature(),
      integrationsChecks: refusingIntegrationsChecksFeature(),
      annotation: refusingAnnotationFeature(),
      savedView: refusingSavedViewFeature(),
      spend: refusingSpendFeature(),
      httpProxy: refusingHttpProxyFeature(),
      modelProvider: refusingModelProviderFeature(),
      share: refusingShareFeature(),
      topic: refusingTopicFeature(),
      trace: refusingTraceFeature(),
      workflow: refusingWorkflowFeature(),
      experiment: refusingExperimentFeature(),
      evaluation: refusingEvaluationFeature(),
      organization: refusingOrganizationFeature(),
      project: refusingProjectFeature(),
      codingAgent: refusingCodingAgentFeature(),
      automation: refusingAutomationFeature(),
      enterprise: refusingEnterpriseFeature(),
    },
    // The features that compose themselves take this rather than a ports
    // entry; every member refuses, for the same reason the ports do.
    infrastructure: {
      prisma: refuseEveryMember("infrastructure.prisma"),
      authz: refuseEveryMember("infrastructure.authz"),
      plans: refuseEveryMember("infrastructure.plans"),
      featureFlags: refuseEveryMember("infrastructure.featureFlags"),
      // The hosted product, so both Enterprise billing namespaces carry their
      // procedures — which is what the lists below read them for.
      saasBilling: true,
      audit: undefined,
    },
  });
}
