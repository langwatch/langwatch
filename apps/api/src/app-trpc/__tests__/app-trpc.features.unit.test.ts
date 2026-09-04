/**
 * The one list, proved to be one list.
 *
 * Two things are pinned here. The first is membership: every namespace the app
 * process serves from this package is built by iterating this record, so a
 * surface that drops out of it stops being mounted — and stops being visible
 * to the declaration sweep — in the same edit. A key that disappears without
 * anyone noticing is exactly the failure the record exists to prevent.
 *
 * The second is that the record hands back the PACKAGED transports rather than
 * something assembled here: each entry is read for the procedure names its
 * feature package defines. A wrapper that quietly built its own router would
 * pass a "the key is present" assertion and fail this one.
 *
 * Nothing in this suite serves a request. The mount is the process's own root and
 * every port refuses, because building a surface is what registers its access
 * decisions — the part the audits read.
 */

import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";

import { declareAuthzMiddleware } from "@langwatch/authz-contract";

import type { TraceLegacyFilterInput, TraceLegacyListInput } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createTrpcRoot } from "../../api.application";
import { composeGatewayFeature } from "../../features/gateway/gateway.composition";
import { refusingLangyFeature } from "../../features/langy/langy.composition";
import { refusingDataRetentionFeature } from "../../features/data-retention/data-retention.composition";
import { refusingAnalyticsFeature } from "../../features/analytics/analytics.composition";
import { refusingDatasetFeature } from "../../features/dataset/dataset.composition";
import { refusingEvaluatorFeature } from "../../features/evaluator/evaluator.composition";
import { refusingPromptFeature } from "../../features/prompt/prompt.composition";
import { refusingFeatureFlagFeature } from "../../features/feature-flag/feature-flag.composition";
import { refusingMonitorFeature } from "../../features/monitor/monitor.composition";
import { refusingHomeFeature } from "../../features/project/home.composition";
import { refusingRoleFeature } from "../../features/role/role.composition";
import { refusingScenarioFeature } from "../../features/scenario/scenario.composition";
import { refusingStoredObjectFeature } from "../../features/stored-object/stored-object.composition";
import { refusingBugReportFeature } from "../../features/bug-report/bug-report.composition";
import { refusingDataPrivacyFeature } from "../../features/data-privacy/data-privacy.composition";
import { refusingIntegrationsChecksFeature } from "../../features/project/integrations-checks.composition";
import { refusingAnnotationFeature } from "../../features/annotation/annotation.composition";
import { refusingSavedViewFeature } from "../../features/dashboard/saved-view.composition";
import { refusingSpendFeature } from "../../features/entitlement/spend.composition";
import { refusingHttpProxyFeature } from "../../features/agent/http-proxy.composition";
import { refusingModelProviderFeature } from "../../features/model-provider/model-provider.composition";
import { refusingShareFeature } from "../../features/share/share.composition";
import { refusingTopicFeature } from "../../features/topic/topic.composition";
import { refusingTraceFeature } from "../../features/trace/trace.composition";
import { refusingWorkflowFeature } from "../../features/workflow/workflow.composition";
import { refusingExperimentFeature } from "../../features/experiment/experiment.composition";
import { refusingEvaluationFeature } from "../../features/evaluation/evaluation.composition";
import { refusingOrganizationFeature } from "../../features/organization/organization.composition";
import { refusingProjectFeature } from "../../features/project/project.composition";
import { refusingCodingAgentFeature } from "../../features/coding-agent/coding-agent.composition";
import { refusingAutomationFeature } from "../../features/automation/automation.composition";
import { refusingEnterpriseFeature } from "../../features/enterprise/enterprise.composition";
import { refusingOpsFeature } from "../../features/ops/ops.composition";
import { createAppTrpcFeatures, type AppTrpcFeaturePorts } from "../app-trpc.features";

import type { TracesTrpcPorts } from "@langwatch/trace-server";

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

/** The sign-up questionnaire, as the process hands its schema to onboarding. */
const testSignUpDataSchema = z.object({ utmCampaign: z.string().optional() });

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
 * Every port refuses when called.
 *
 * The exceptions are real Zod schemas and a pass-through gate rather than
 * refusals, because those are read while the surface is being BUILT — they
 * become the procedures' input parsers and their chained middleware — so a
 * refusal there could not be mounted at all.
 */
function refusingPorts(): AppTrpcFeaturePorts<typeof testSignUpDataSchema> {
  const refuse = (what: string) => (): never => {
    throw new Error(`${what} was reached while building the feature list`);
  };

  const refuseEvery = (what: string) =>
    new Proxy({}, { get: (_target, member) => refuse(`${what}.${String(member)}`) }) as never;

  return {
    auth: refuseEvery("auth"),
    group: refuseEvery("group"),
    identity: refuseEvery("identity"),
    joinRequests: refuseEvery("joinRequests"),
    // The questionnaire schema is read while the surface is BUILT — it becomes
    // `initializeOrganization`'s own input parser — so it is a real schema
    // rather than a refusal.
    onboarding: {
      ...(refuseEvery("onboarding") as object),
      signUpDataSchema: testSignUpDataSchema,
    } as never,
    prisma: refuseEvery("prisma"),
    user: refuseEvery("user"),
  };
}

function buildFeatures() {
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
    ports: refusingPorts(),
  });
}

/**
 * Every door under the `analytics` namespace, as the client calls them.
 *
 * Named here rather than inline because the merge is the only entry in the list
 * that assembles more than one packaged transport, and the whole point of
 * naming them is that all three owners' doors are present on one wire name.
 */
const ANALYTICS_PROCEDURES = [
  "dataForFilter",
  "feedbacks",
  "getTimeseries",
  "lwql.availability",
  "lwql.query",
  "lwql.schema",
  "savedWorkbenchCharts.create",
  "savedWorkbenchCharts.delete",
  "savedWorkbenchCharts.getAll",
  "savedWorkbenchCharts.getById",
  "savedWorkbenchCharts.run",
  "savedWorkbenchCharts.update",
  "topUsedDocuments",
];

/** The procedure paths one mounted router answers on. */
const procedureNamesOf = (router: unknown): string[] =>
  Object.keys((router as { _def: { procedures: Record<string, unknown> } })._def.procedures).sort();

describe("the app tRPC feature list", () => {
  describe("given one process mount", () => {
    it("builds every namespace the app process serves from this package", () => {
      expect(Object.keys(buildFeatures()).sort()).toEqual([
        "activityMonitor",
        "aiTools",
        "analytics",
        "annotation",
        "annotationScore",
        "anomalyRules",
        "apiKey",
        "authz",
        "automation",
        "batchRecord",
        "bugReports",
        "codingAgents",
        "costs",
        "currency",
        "dashboards",
        "dataPrivacy",
        "dataRetention",
        "dataset",
        "datasetRecord",
        "departments",
        "emailSuppression",
        "evaluations",
        "evaluators",
        "experiments",
        "export",
        "featureFlag",
        "frontDoor",
        "gatewayBudgets",
        "gatewayCacheRules",
        "gatewayGuardrails",
        "gatewaySpendEvents",
        "gatewayUsage",
        "github",
        "governance",
        "graphs",
        "group",
        "home",
        "httpProxy",
        "identity",
        "ingestionKey",
        "ingestionSources",
        "ingestionTemplates",
        "integrationsChecks",
        "joinRequests",
        "langy",
        "langyEgress",
        "license",
        "licenseEnforcement",
        "limits",
        "llmModelCost",
        "modelProvider",
        "monitors",
        "onboarding",
        "ops",
        "optimization",
        "organization",
        "personalSessions",
        "personalVirtualKeys",
        "personalWorkspaceFeatures",
        "pinnedTrace",
        "plan",
        "presence",
        "project",
        "promptTags",
        "prompts",
        "publicEnv",
        "role",
        "roleBinding",
        "routingPolicy",
        "savedViews",
        "scenarios",
        "scimToken",
        "sessionPolicy",
        "setupSkills",
        "share",
        "sharedTrace",
        "spans",
        "ssoConnections",
        "storedObjects",
        "subscription",
        "suites",
        "team",
        "topics",
        "traceEditOverlay",
        "traces",
        "tracesV2",
        "translate",
        "user",
        "virtualKeys",
        "webhookEndpoints",
        "workflow",
      ]);
    });

    it("hands back the packaged transport for each namespace, procedure names intact", () => {
      const features = buildFeatures();

      // One namespace, three packaged transports. The dotted names are what
      // makes the merge visible: the charted reads answer at the top of
      // `analytics.*`, the workbench under `lwql.`, and the saved charts under
      // `savedWorkbenchCharts.` — so a door dropped from the merge, or one that
      // quietly moved to a different name, fails here rather than at a client.
      expect(procedureNamesOf(features.analytics)).toEqual(ANALYTICS_PROCEDURES);
      expect(procedureNamesOf(features.annotationScore)).toEqual([
        "delete",
        "getAll",
        "getAllActive",
        "getById",
        "toggle",
        "upsert",
      ]);
      expect(procedureNamesOf(features.apiKey)).toEqual([
        "create",
        "list",
        "myBindings",
        "nameById",
        "orgMembers",
        "orgProjects",
        "orgTeams",
        "revoke",
        "update",
      ]);
      // The support inbox: two reads, and the pair is the whole surface. The
      // public REST intake that FILES a report is a different door and is not
      // in this list.
      expect(procedureNamesOf(features.bugReports)).toEqual(["getAll", "getById"]);
      // The privacy settings screen: one read and the two writes it drives.
      // Every answer comes back through a port, so what this pins is that the
      // three names the settings page calls are the packaged ones.
      expect(procedureNamesOf(features.dataPrivacy)).toEqual([
        "getSnapshot",
        "removeForScope",
        "setForScope",
      ]);
      // The export-progress relays. Both names are what the traces grid and the
      // simulations screen subscribe to, and they are the two of this list's
      // procedures that STREAM — so a rename here is a live view that silently
      // stops updating rather than a call that fails.
      expect(procedureNamesOf(features.export)).toEqual([
        "onExportProgress",
        "onScenarioRunExportProgress",
      ]);
      expect(procedureNamesOf(features.identity)).toEqual(["completeVerification"]);
      // The sign-up ceremony. Its follow-ups all answer through ports, so what
      // this pins is that the two names the sign-up screens call are the
      // packaged ones — mounted beside the `organization.createAndAssign` they
      // are built on rather than assembled a second time in the app router.
      expect(procedureNamesOf(features.onboarding)).toEqual([
        "initializeOrganization",
        "setIntegrationMethod",
      ]);
      // The project's setup rollup. Its evidence comes from nine other
      // verticals through a port, so the one thing this pins is that the
      // procedure the onboarding surfaces call is the packaged one.
      expect(procedureNamesOf(features.integrationsChecks)).toEqual(["getCheckStatus"]);
      // Who else is in the project. `onPresenceUpdate` and `onPresenceCursor`
      // are the two of this namespace's procedures that STREAM, which is the
      // reason presence is in the record at all: mounted beside it they would
      // answer over `/api/trpc` and be invisible to the subscription lane.
      expect(procedureNamesOf(features.presence)).toEqual([
        "cursor",
        "leave",
        "onPresenceCursor",
        "onPresenceUpdate",
        "update",
      ]);
      // The account surface, merged with the Enterprise /me dashboard reads:
      // `personalUsage`, `budgetOverview` and `cliBootstrap` answer on the
      // same `user.*` name but are mounted from the Enterprise composition
      // (`personalDashboard`), so this pins that the merge lands all three
      // packaged names on the one namespace rather than a copy growing here.
      expect(procedureNamesOf(features.user)).toEqual([
        "budgetOverview",
        "changePassword",
        "cliBootstrap",
        "deactivate",
        "dismissPasskeyNudge",
        "dismissTraceExplorerTour",
        "getAccountInfo",
        "getLinkedAccounts",
        "getSsoStatus",
        "getTraceExplorerTourPreference",
        "hasPassword",
        "homePagePickerState",
        "isAdmin",
        "passkeyNudge",
        "personalBudget",
        "personalContext",
        "personalUsage",
        "reactivate",
        "register",
        "removeAvatar",
        "requestBudgetIncrease",
        "setAvatar",
        "setLastHomePath",
        "setPassword",
        "unlinkAccount",
        "updateLastLogin",
      ]);
      // Two namespaces for one feature, and the studio's own is not a subset of
      // the lifecycle's: naming both is what would catch either being dropped.
      expect(procedureNamesOf(features.optimization)).toEqual([
        "chat",
        "disableAsComponent",
        "disableAsEvaluator",
        "getComponents",
        "getPublishedWorkflow",
        "toggleSaveAsComponent",
        "toggleSaveAsEvaluator",
      ]);
    });

    it("mounts publicEnv as a bare procedure, because that is the name the client calls", () => {
      const publicEnv = buildFeatures().publicEnv as { _def: { type: string; procedure: boolean } };

      expect(publicEnv._def.procedure).toBe(true);
      expect(publicEnv._def.type).toBe("query");
    });

    it("leaves no namespace without procedures", () => {
      const features = buildFeatures();
      const routers = Object.entries(features).filter(([name]) => name !== "publicEnv");

      for (const [name, router] of routers) {
        expect({ name, procedures: procedureNamesOf(router).length > 0 }).toEqual({
          name,
          procedures: true,
        });
      }
    });
  });
});
