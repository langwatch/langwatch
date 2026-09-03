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
 * Nothing in this suite serves a request. The mount is a bare tRPC root and
 * every port refuses, because building a surface is what registers its access
 * decisions — the part the audits read.
 */
import {
  analyticsReadInputSchema,
  analyticsTimeseriesInputSchema,
  type AnalyticsReadInput,
  type AnalyticsTimeseriesInput,
} from "@langwatch/analytics-contract";
import type { AnalyticsTrpcContext, LangWatchQLTrpcContext } from "@langwatch/analytics-server";
import type {
  AnnotationScoreTrpcContext,
  AnnotationTrpcContext,
  AnnotationTrpcPorts,
} from "@langwatch/annotation-server";
import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";
import type { ApiKeyTrpcContext } from "@langwatch/api-key-server";
import type { FrontDoorTrpcContext, PublicEnvTrpcContext } from "@langwatch/auth-server";
import { declareAuthzMiddleware } from "@langwatch/authz-contract";
import type {
  AutomationTrpcContext,
  EmailSuppressionTrpcContext,
} from "@langwatch/automation-server";
import type { AuthzTrpcContext } from "@langwatch/authz-server";
import type { CodingAgentTrpcContext } from "@langwatch/coding-agent-server";
import type { EnterpriseTrpcContext } from "@langwatch/enterprise-api";
import type {
  DashboardTrpcContext,
  GraphTrpcContext,
  SavedViewTrpcContext,
  SavedWorkbenchChartTrpcContext,
} from "@langwatch/dashboard-server";
import type { DataPrivacyTrpcContext } from "@langwatch/data-privacy-server";
import type {
  BatchRecordTrpcContext,
  DatasetRecordTrpcContext,
  DatasetTrpcContext,
} from "@langwatch/dataset-server";
import type { EvaluationTrpcContext } from "@langwatch/evaluation-server";
import type { EvaluatorTrpcContext } from "@langwatch/evaluator-server";
import type { ExperimentTrpcContext } from "@langwatch/experiment-server";
import type { ExportTrpcContext } from "../../features/export/export-trpc.mount";
import type { GithubTrpcContext } from "../../features/github/github-trpc.mount";
import type { BugReportTrpcContext, OpsTrpcContext } from "@langwatch/ops-server";
import type {
  LangyEgressTrpcContext,
  LangyTrpcContext,
  SetupSkillsTrpcContext,
} from "@langwatch/langy-server";
import type { ScenarioTrpcContext } from "@langwatch/scenario-server";
import type { SuiteTrpcContext } from "@langwatch/suite-server";
import type {
  GroupTrpcContext,
  JoinRequestTrpcContext,
  OnboardingTrpcContext,
  OrganizationTrpcContext,
  OrganizationTrpcPorts,
  PersonalWorkspaceFeaturesTrpcContext,
  TeamTrpcContext,
} from "@langwatch/organization-server";
import type { RoleBindingTrpcContext, RoleTrpcContext } from "@langwatch/role-server";
import type { PresenceTrpcContext } from "@langwatch/presence-server";
import type { FeatureFlagTrpcContext } from "@langwatch/feature-flag-server";
import type {
  HomeTrpcContext,
  IntegrationsChecksTrpcContext,
  ProjectTrpcContext,
} from "@langwatch/project-server";
import type { AutomationMountPorts } from "../../features/automation/automation-trpc.mount";
import type { PromptTrpcContext } from "@langwatch/prompt-server";
import type { IdentityTrpcContext, UserTrpcContext } from "@langwatch/user-server";
import type {
  WorkflowOptimizationTrpcContext,
  WorkflowTrpcContext,
} from "@langwatch/workflow-server";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { EnterpriseBillingTrpcContext } from "../../features/enterprise/enterprise-billing-trpc.mount";
import type { EnterpriseGovernanceMountContext } from "../../features/enterprise/enterprise-governance-trpc.mount";
import type { GovernanceHomeTrpcContext } from "../../features/enterprise/governance-home.mount";
import type { GatewayTrpcContext } from "../../features/gateway/gateway-trpc.mount";
import {
  createAppTrpcFeatures,
  type AppTrpcFeaturePorts,
} from "../app-trpc.features";
import type { DataRetentionTrpcContext } from "@langwatch/data-retention-server";
import type { MonitorTrpcContext } from "@langwatch/monitor-server";
import type { StoredObjectTrpcContext } from "@langwatch/stored-object-server";
import type { HttpProxyTrpcContext } from "@langwatch/agent-server";
import type {
  CostTrpcContext,
  LimitsTrpcContext,
  PlanTrpcContext,
} from "@langwatch/entitlement-server";
import type {
  LlmModelCostTrpcContext,
  ModelProviderTrpcContext,
  TranslateTrpcContext,
} from "@langwatch/model-provider-server";
import type { PinnedTraceTrpcContext, ShareTrpcContext } from "@langwatch/share-server";
import type { TopicTrpcContext } from "@langwatch/topic-server";
import type {
  SharedTraceTrpcContext,
  SpansTrpcContext,
  TraceEditOverlayTrpcContext,
  TracesTrpcContext,
  TracesTrpcPorts,
  TracesV2TrpcContext,
} from "@langwatch/trace-server";

/**
 * The intersection every mounted surface constrains the process's context to.
 * Stating it here is what makes a feature whose context grows a compile error
 * in this suite rather than a surprise in the app.
 */
type TestContext = AnalyticsTrpcContext &
  EnterpriseBillingTrpcContext &
  EnterpriseGovernanceMountContext &
  GatewayTrpcContext &
  GovernanceHomeTrpcContext &
  AuthzTrpcContext &
  AnnotationTrpcContext &
  AnnotationScoreTrpcContext &
  ApiKeyTrpcContext &
  BugReportTrpcContext &
  DashboardTrpcContext &
  BatchRecordTrpcContext &
  DataPrivacyTrpcContext &
  DatasetRecordTrpcContext &
  DatasetTrpcContext &
  EvaluationTrpcContext &
  EvaluatorTrpcContext &
  ExperimentTrpcContext &
  ExportTrpcContext &
  FrontDoorTrpcContext &
  GithubTrpcContext &
  GraphTrpcContext &
  GroupTrpcContext &
  HomeTrpcContext &
  IdentityTrpcContext &
  IntegrationsChecksTrpcContext &
  JoinRequestTrpcContext &
  LangWatchQLTrpcContext &
  OnboardingTrpcContext &
  PersonalWorkspaceFeaturesTrpcContext &
  PresenceTrpcContext &
  RoleBindingTrpcContext &
  RoleTrpcContext &
  TeamTrpcContext &
  PublicEnvTrpcContext &
  SavedWorkbenchChartTrpcContext &
  UserTrpcContext &
  FeatureFlagTrpcContext &
  PromptTrpcContext &
  WorkflowOptimizationTrpcContext &
  WorkflowTrpcContext &
  CostTrpcContext &
  HttpProxyTrpcContext &
  LimitsTrpcContext &
  LlmModelCostTrpcContext &
  ModelProviderTrpcContext &
  PinnedTraceTrpcContext &
  PlanTrpcContext &
  SavedViewTrpcContext &
  ShareTrpcContext &
  SharedTraceTrpcContext &
  SpansTrpcContext &
  TopicTrpcContext &
  TraceEditOverlayTrpcContext &
  TracesTrpcContext &
  TracesV2TrpcContext &
  TranslateTrpcContext &
  // The three product-infrastructure surfaces, for the same reason.
  DataRetentionTrpcContext &
  MonitorTrpcContext &
  StoredObjectTrpcContext &
  AutomationTrpcContext &
  CodingAgentTrpcContext &
  EmailSuppressionTrpcContext &
  EnterpriseTrpcContext &
  OrganizationTrpcContext &
  ProjectTrpcContext &
  LangyEgressTrpcContext &
  LangyTrpcContext &
  OpsTrpcContext &
  ScenarioTrpcContext &
  SetupSkillsTrpcContext &
  SuiteTrpcContext;

/** A pass-through stand-in for one of the process's policy middlewares. */
const passThrough =
  () =>
  ({ next }: { next: () => Promise<unknown> }) =>
    next();

/**
 * A rollout gate that lets every procedure through.
 *
 * Chained onto the builder as the surface is BUILT, so unlike the ports below
 * it cannot refuse: a refusing gate would mean no workbench procedure exists to
 * read the names of.
 */
const passThroughGate = <TProcedure>(procedure: TProcedure): TProcedure => procedure;

/** The period a workbench caller reports over, as the two doors parse it. */
const testTimeWindowSchema = z.object({ start: z.date(), end: z.date() });

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
function refusingPorts(): AppTrpcFeaturePorts<
  AnnotationTrpcPorts,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  string,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  AnalyticsReadInput,
  typeof testSignUpDataSchema,
  AnalyticsTimeseriesInput,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>
> {
  const refuse = (what: string) => (): never => {
    throw new Error(`${what} was reached while building the feature list`);
  };

  const refuseEvery = (what: string) =>
    new Proxy({}, { get: (_target, member) => refuse(`${what}.${String(member)}`) }) as never;

  /** A refusing check that still carries a declaration, as the real ones do. */
  const refusingCheck = (what: string) =>
    declareAuthzMiddleware(
      {
        kind: "service-authorized",
        reason: `${what} is enforced by the process's resolver`,
        permissions: [],
        enforces: { projectId: what },
      },
      refuse(what) as unknown as (params: never) => Promise<unknown>,
    );

  return {
    // Every schema here is read while the surface is BUILT — the parsers become
    // the procedures' own — and so is the rollout gate, which is chained onto
    // each builder. Refusals in those places could not be mounted at all.
    analytics: {
      reads: {
        timeseriesInputSchema: analyticsTimeseriesInputSchema,
        sharedFiltersSchema: analyticsReadInputSchema,
        filterFieldSchema: z.enum(["metadata.user_id"]),
        filterFieldRequiresKey: refuse("analytics.reads.filterFieldRequiresKey"),
        filterFieldRequiresSubkey: refuse("analytics.reads.filterFieldRequiresSubkey"),
      },
      workbench: {
        requireWorkbenchEnabled: passThroughGate,
        isWorkbenchEnabled: refuse("analytics.workbench.isWorkbenchEnabled"),
        maxStatementLength: 8_000,
        timeWindowSchema: testTimeWindowSchema,
        granularityStepSchema: z.number(),
        resolveProtections: refuse("analytics.workbench.resolveProtections"),
        resolveRunCaller: refuse("analytics.workbench.resolveRunCaller"),
      },
      savedCharts: {
        requireWorkbenchEnabled: passThroughGate,
        timeWindowSchema: testTimeWindowSchema,
        granularityStepSchema: z.number(),
        resolveProtections: refuse("analytics.savedCharts.resolveProtections"),
        resolveRunCaller: refuse("analytics.savedCharts.resolveRunCaller"),
        admitDefinition: refuse("analytics.savedCharts.admitDefinition"),
        mapError: refuse("analytics.savedCharts.mapError"),
      },
    },
    annotation: refuseEvery("annotation"),
    apiKeyAudit: refuse("apiKeyAudit"),
    batchRecord: refuseEvery("batchRecord"),
    bugReports: refuseEvery("bugReports"),
    dataset: refuseEvery("dataset"),
    auth: refuseEvery("auth"),
    dataPrivacy: refuseEvery("dataPrivacy"),
    // Read while the two writes are BUILT — the policy chain lifts each
    // declaration off the middleware it is handed — so these are declared
    // checks rather than refusals.
    dataPrivacyScopeChecks: {
      write: refusingCheck("dataPrivacyScopeChecks.write"),
      removal: refusingCheck("dataPrivacyScopeChecks.removal"),
    },
    evaluations: {
      ...(refuseEvery("evaluations") as object),
      mappingsSchema: z.object({ mapping: z.record(z.string(), z.unknown()) }),
    } as never,
    experiments: {
      ...(refuseEvery("experiments") as object),
      workbenchStateSchema: z.object({ rows: z.array(z.unknown()) }),
    } as never,
    evaluators: refuseEvery("evaluators"),
    graphs: {
      ...(refuseEvery("graphs") as object),
      filterFieldSchema: z.enum(["metadata.user_id"]),
    } as never,
    group: refuseEvery("group"),
    home: refuseEvery("home"),
    identity: refuseEvery("identity"),
    integrationsChecks: refuseEvery("integrationsChecks"),
    joinRequests: refuseEvery("joinRequests"),
    // The questionnaire schema is read while the surface is BUILT — it becomes
    // `initializeOrganization`'s own input parser — so it is a real schema
    // rather than a refusal.
    onboarding: {
      ...(refuseEvery("onboarding") as object),
      signUpDataSchema: testSignUpDataSchema,
    } as never,
    prisma: refuseEvery("prisma"),
    prompts: refuseEvery("prompts"),
    role: {
      ...(refuseEvery("role") as object),
      customRolePermission: z.string(),
    } as never,
    team: refuseEvery("team"),
    // The observability group, as one entry. Its build-time members are the
    // two trace grid schemas, the evaluator and precondition schemas, the
    // cost-rule safety gate the write and preview schemas are constructed
    // from, and the two provider tenant gates the policy chain lifts a
    // declaration off. Everything else refuses.
    /**
     * The six agent surfaces, stubbed with only what the record reads while
     * it is BUILT: the two Langy gates and the operator check the mounts
     * chain onto a procedure. Their own suites are what prove they answer.
     */
    langy: refuseEvery("langy"),
    langyGates: {
      refuseDemoProject: passThrough(),
      enforceLangyAccess: passThrough(),
    },
    langyEgress: refuseEvery("langyEgress"),
    ops: refuseEvery("ops"),
    opsCheck: () => refusingCheck("opsCheck"),
    scenarios: refuseEvery("scenarios"),
    /**
     * The nine tenant-administration surfaces, stubbed with only what the
     * record reads while it is BUILT: the sign-up questionnaire the
     * organization ceremony parses against, and the three data-dependent
     * gates the mounts chain onto a procedure. Its own suite is what proves it
     * answers.
     */
    organization: {
      ...(refuseEvery("organization") as object),
      signUpDataSchema: testSignUpDataSchema,
      isCustomRole: () => false,
    } as unknown as OrganizationTrpcPorts<typeof testSignUpDataSchema>,
    organizationAuditLogCheck: refusingCheck("organizationAuditLogCheck"),
    project: refuseEvery("project"),
    projectChecks: {
      create: refusingCheck("projectChecks.create"),
      traceSharing: refusingCheck("projectChecks.traceSharing"),
    },
    codingAgents: refuseEvery("codingAgents"),
    automation: {
      ...(refuseEvery("automation") as object),
      providers: refuseEvery("automation.providers"),
    } as unknown as AutomationMountPorts,
    emailSuppression: refuseEvery("emailSuppression"),
    enterprise: {
      scimToken: refuseEvery("enterprise.scimToken"),
      ssoConnections: refuseEvery("enterprise.ssoConnections"),
    },
    traces: {
      ...(refuseEvery("traces") as object),
      listInputSchema: z.object({ projectId: z.string() }),
      filterInputSchema: z.object({ projectId: z.string() }),
      evaluatorTypeSchema: z.string(),
      preconditionSchema: z.object({ field: z.string() }),
    } as unknown as TracesTrpcPorts,
    tracesV2: refuseEvery("tracesV2"),
    spans: refuseEvery("spans"),
    traceEditOverlay: refuseEvery("traceEditOverlay"),
    sharedTrace: refuseEvery("sharedTrace"),
    savedViews: { savedViews: refuseEvery("savedViews") },
    costs: refuseEvery("costs"),
    llmModelCost: {
      ...(refuseEvery("llmModelCost") as object),
      isSafeRegex: () => true,
    },
    modelProvider: refuseEvery("modelProvider"),
    modelProviderChecks: {
      tenantWrite: (permission: string) =>
        refusingCheck(`modelProviderChecks.tenantWrite.${permission}`),
      credentialProbe: refusingCheck("modelProviderChecks.credentialProbe"),
    },
    translate: refuseEvery("translate"),
    httpProxy: refuseEvery("httpProxy"),
    limits: refuseEvery("limits"),
    // The monitor precondition parser, which the create and update inputs are
    // constructed from; everything else refuses. `storedObjects` is absent
    // because it takes no ports at all.
    dataRetention: refuseEvery("dataRetention"),
    monitors: {
      ...(refuseEvery("monitors") as object),
      preconditionsSchema: z.array(z.object({ field: z.string() })),
    } as never,
    // The virtual-key budget parser, fixed when the router is BUILT because a
    // tRPC input parser is.
    gateway: { virtualKeys: { virtualKeyBudgetInput: z.object({}) } } as never,
    governanceHome: refuseEvery("governanceHome"),
    // The SaaS shape, because this suite's last assertion is that no
    // namespace mounts without procedures: `false` is the self-hosted answer,
    // and it deliberately serves `subscription` and `currency` as empty
    // routers of the same type. Which shape a deployment gets is the gateway
    // group's own suite to pin.
    saasBilling: true,
    github: refuseEvery("github"),
    user: refuseEvery("user"),
    workflows: {
      lifecycle: refuseEvery("workflows.lifecycle"),
      optimization: refuseEvery("workflows.optimization"),
    },
  };
}

function buildFeatures() {
  const trpc = initTRPC.context<TestContext>().create();

  return createAppTrpcFeatures({
    mount: {
      root: trpc,
      protectedProcedure: trpc.procedure,
      publicProcedure: trpc.procedure,
      middlewares,
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
