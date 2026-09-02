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
  DashboardTrpcContext,
  GraphTrpcContext,
  SavedWorkbenchChartTrpcContext,
} from "@langwatch/dashboard-server";
import type { DataPrivacyTrpcContext } from "@langwatch/data-privacy-server";
import type { EvaluationTrpcContext } from "@langwatch/evaluation-server";
import type { ExperimentTrpcContext } from "@langwatch/experiment-server";
import type { ExportTrpcContext } from "../../features/export/export-trpc.mount";
import type { BugReportTrpcContext } from "@langwatch/ops-server";
import type {
  GroupTrpcContext,
  JoinRequestTrpcContext,
  OnboardingTrpcContext,
} from "@langwatch/organization-server";
import type { IntegrationsChecksTrpcContext } from "@langwatch/project-server";
import type { IdentityTrpcContext, UserTrpcContext } from "@langwatch/user-server";
import type {
  WorkflowOptimizationTrpcContext,
  WorkflowTrpcContext,
} from "@langwatch/workflow-server";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAppTrpcFeatures, type AppTrpcFeaturePorts } from "../app-trpc.features";

/**
 * The intersection every mounted surface constrains the process's context to.
 * Stating it here is what makes a feature whose context grows a compile error
 * in this suite rather than a surprise in the app.
 */
type TestContext = AnalyticsTrpcContext &
  AnnotationTrpcContext &
  AnnotationScoreTrpcContext &
  ApiKeyTrpcContext &
  BugReportTrpcContext &
  DashboardTrpcContext &
  DataPrivacyTrpcContext &
  EvaluationTrpcContext &
  ExperimentTrpcContext &
  ExportTrpcContext &
  FrontDoorTrpcContext &
  GraphTrpcContext &
  GroupTrpcContext &
  IdentityTrpcContext &
  IntegrationsChecksTrpcContext &
  JoinRequestTrpcContext &
  LangWatchQLTrpcContext &
  OnboardingTrpcContext &
  PublicEnvTrpcContext &
  SavedWorkbenchChartTrpcContext &
  UserTrpcContext &
  WorkflowOptimizationTrpcContext &
  WorkflowTrpcContext;

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
    bugReports: refuseEvery("bugReports"),
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
    graphs: {
      ...(refuseEvery("graphs") as object),
      filterFieldSchema: z.enum(["metadata.user_id"]),
    } as never,
    group: refuseEvery("group"),
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
        "analytics",
        "annotation",
        "annotationScore",
        "apiKey",
        "bugReports",
        "dashboards",
        "dataPrivacy",
        "evaluations",
        "experiments",
        "export",
        "frontDoor",
        "graphs",
        "group",
        "identity",
        "integrationsChecks",
        "joinRequests",
        "onboarding",
        "optimization",
        "publicEnv",
        "user",
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
      // The account surface only. `personalUsage`, `budgetOverview` and
      // `cliBootstrap` answer on the same `user.*` name in the app, but they
      // read governance data and are mounted from the Enterprise composition,
      // so a copy of them appearing here would mean the feature had grown a
      // second owner.
      expect(procedureNamesOf(features.user)).toEqual([
        "changePassword",
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
