/**
 * Every tRPC surface this package owns, mounted on one process's root.
 *
 * The one list. A tRPC procedure declares its access decision as it is BUILT,
 * and the declaration sweep, the public-surface tripwire and the Langy
 * permission suites all read what mounting registered — so a family enumerated
 * a second time somewhere else could serve traffic while sitting outside every
 * one of those audits. Mount them by iterating this record, and read them the
 * same way: a surface is either in here and visible, or it does not exist.
 *
 * The process supplies its mount ONCE — the root a feature router must never
 * create a second of, the authenticated and public procedures it builds on,
 * and the concrete middlewares its policy chain is composed from — rather than
 * once per feature. That is the difference this file makes: a restated copy of
 * the same chain per feature could drift, and one cannot.
 */
import type { AnalyticsReadInput, AnalyticsTimeseriesInput } from "@langwatch/analytics-contract";
import type {
  AnalyticsTrpcContext,
  AnalyticsTrpcPorts,
  LangWatchQLTrpcContext,
  LangWatchQLTrpcPorts,
} from "@langwatch/analytics-server";
import type {
  AnnotationScoreTrpcContext,
  AnnotationTrpcContext,
  AnnotationTrpcPorts,
} from "@langwatch/annotation-server";
import type { TrpcApiMount, TrpcApiPublicMount } from "@langwatch/api/trpc";
import type { ApiKeyTrpcContext } from "@langwatch/api-key-server";
import type { AuthApp, FrontDoorTrpcContext, PublicEnvTrpcContext } from "@langwatch/auth-server";
import type { DataPrivacyTrpcContext, DataPrivacyTrpcPorts } from "@langwatch/data-privacy-server";
import type {
  DashboardTrpcContext,
  GraphTrpcContext,
  GraphTrpcPorts,
  SavedWorkbenchChartTrpcContext,
  SavedWorkbenchChartTrpcPorts,
} from "@langwatch/dashboard-server";
import type { EvaluationTrpcContext } from "@langwatch/evaluation-server";
import type { ExperimentTrpcContext, ExperimentTrpcPorts } from "@langwatch/experiment-server";
import type { BugReportTrpcContext, BugReportTrpcPorts } from "@langwatch/ops-server";
import type {
  GroupTrpcContext,
  GroupTrpcPorts,
  JoinRequestTrpcContext,
  JoinRequestTrpcPorts,
  OnboardingTrpcContext,
  OnboardingTrpcPorts,
} from "@langwatch/organization-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type {
  IntegrationsChecksTrpcContext,
  IntegrationsChecksTrpcPorts,
} from "@langwatch/project-server";
import type {
  IdentityTrpcContext,
  IdentityTrpcPorts,
  UserTrpcContext,
  UserTrpcPorts,
} from "@langwatch/user-server";
import type {
  WorkflowOptimizationTrpcContext,
  WorkflowOptimizationTrpcPorts,
  WorkflowTrpcContext,
  WorkflowTrpcPorts,
} from "@langwatch/workflow-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";
import type { ZodTypeAny } from "zod";

import {
  createAnalyticsTrpcRouter,
  createLangWatchQLTrpcRouter,
} from "../features/analytics/analytics-trpc.mount";
import {
  createAnnotationScoreTrpcRouter,
  createAnnotationTrpcRouter,
} from "../features/annotation/annotation-trpc.mount";
import {
  createApiKeyTrpcRouter,
  type ApiKeyAuditSink,
} from "../features/api-key/api-key-trpc.mount";
import {
  createFrontDoorTrpcRouter,
  createPublicEnvTrpcProcedure,
} from "../features/auth/auth-trpc.mount";
import {
  createDashboardTrpcRouter,
  createGraphTrpcRouter,
  createSavedWorkbenchChartTrpcRouter,
} from "../features/dashboard/dashboard-trpc.mount";
import {
  createDataPrivacyTrpcRouter,
  type DataPrivacyTrpcChecks,
} from "../features/data-privacy/data-privacy-trpc.mount";
import {
  createEvaluationTrpcRouter,
  type EvaluationMountPorts,
} from "../features/evaluation/evaluation-trpc.mount";
import { createExperimentTrpcRouter } from "../features/experiment/experiment-trpc.mount";
import {
  createExportTrpcRouter,
  type ExportTrpcContext,
} from "../features/export/export-trpc.mount";
import { createBugReportTrpcRouter } from "../features/ops/ops-trpc.mount";
import {
  createGroupTrpcRouter,
  createJoinRequestTrpcRouter,
  createOnboardingTrpcRouter,
} from "../features/organization/organization-trpc.mount";
import { createIntegrationsChecksTrpcRouter } from "../features/project/project-trpc.mount";
import { createIdentityTrpcRouter, createUserTrpcRouter } from "../features/user/user-trpc.mount";
import {
  createWorkflowOptimizationTrpcRouter,
  createWorkflowTrpcRouter,
} from "../features/workflow/workflow-trpc.mount";

/**
 * The capabilities these surfaces reach that their own feature packages do not
 * own — one entry per feature that has any, so a new port is a change to one
 * group rather than to this interface's shape.
 *
 * Every one of them resolves something only the application knows: its
 * database rows, its trace pipeline, its deployment's billing store, its
 * sign-in ceremony. None can be answered inside a transport package, so the
 * process binds them once here, the way it supplies the mount itself.
 */
export interface AppTrpcFeaturePorts<
  TAnnotationPorts extends AnnotationTrpcPorts,
  TBugReport,
  TBugReportPage,
  TCheckStatus,
  TFilterField extends string,
  TMappingsIn,
  TMappingsOut,
  TPrivacyRule,
  TPrivacySnapshot,
  TReadInput extends AnalyticsReadInput,
  TSignUpDataSchema extends ZodTypeAny,
  TTimeseriesInput extends AnalyticsTimeseriesInput,
  TWorkbenchState,
  TWorkflowVersion,
  TPublishedComponent,
  TTimeseriesInputWire = unknown,
  TReadInputWire = unknown,
> {
  /**
   * One namespace, three transports, two owners — so one entry with a group
   * per transport inside it.
   *
   * `reads` answers the charted `analytics.*` reads, `workbench` the
   * LangWatchQL doors under `analytics.lwql`, and `savedCharts` the stored
   * workbench charts under `analytics.savedWorkbenchCharts` — which belong to
   * Dashboard, because that is where the `saved-workbench-chart` subject
   * lives even though the name a member reaches it through is this one.
   *
   * What all three reach for is the same kind of thing: the shared analytics
   * input schemas and the filter catalogue this deployment offers, the
   * workbench rollout gate, the member's own content protections, and the
   * project identity a restricted statement executes as. None of it is
   * Analytics' or Dashboard's to know.
   */
  analytics: {
    reads: AnalyticsTrpcPorts<
      TTimeseriesInput,
      TReadInput,
      TFilterField,
      TTimeseriesInputWire,
      TReadInputWire
    >;
    workbench: LangWatchQLTrpcPorts;
    savedCharts: SavedWorkbenchChartTrpcPorts;
  };
  /**
   * The annotation queue rows, the trace reads that resolve an item's content
   * for a reviewer, the correction overlay a suggested output is carried into,
   * and the trace-side record of "a human commented on this". Generic over the
   * concrete group because those return types are what the client sees.
   */
  annotation: TAnnotationPorts;
  /**
   * The process's audit trail for credential writes. Fire and forget: a
   * credential response never waits on the audit write.
   */
  apiKeyAudit: ApiKeyAuditSink["recordAudit"];
  /**
   * The support inbox and the audit trail every read of it is written to. The
   * reports themselves are a global table with no tenant column, filed against
   * the product by `langwatch report` and the MCP tool, so the process reads
   * them the way it reads any other back-office resource.
   */
  bugReports: BugReportTrpcPorts<TBugReportPage, TBugReport>;
  /**
   * The composed auth application BOTH signed-out doors answer from — the
   * front door and `publicEnv` beside it. One instance rather than two,
   * because the sign-in mode it resolves is the one ADR-027 source of truth
   * for the whole deployment and the two doors must never disagree.
   */
  auth: AuthApp;
  /**
   * The privacy settings surface's three answers: the snapshot the screen
   * renders, and the two writes.
   *
   * All three are the application's rather than the feature's, and for the
   * same reason. The snapshot is assembled from the organization, department,
   * team and group storage the data-privacy package may not reach and filtered
   * by the caller's permission at each tier; both writes first anchor the
   * target scope to the project's organization and then probe the permission
   * that tier demands. What the package owns is the wire: the tiers, the
   * durable configuration parser, and the two failures a caller can act on.
   */
  dataPrivacy: DataPrivacyTrpcPorts<TPrivacySnapshot, TPrivacyRule>;
  /**
   * The declarations those two writes are checked under, already built.
   *
   * They are middlewares rather than descriptions because each one CLAIMS
   * which assertion enforces the project id, and the declaration sweep counts
   * a claim as coverage. A claim has to be written where the enforcement is.
   */
  dataPrivacyScopeChecks: DataPrivacyTrpcChecks;
  /**
   * The trace-mapping registry, the project's Azure Safety credentials, this
   * install's evaluator inventory and environment, the trace evaluation
   * runner, product analytics and the evaluator runtime's keep-alive probe.
   * `listCustomEvaluators` is absent because the mount builds it from
   * `prisma` below.
   */
  evaluations: EvaluationMountPorts<TMappingsIn, TMappingsOut>;
  /**
   * The workflow, monitor and identity collaborators an experiment still
   * reaches through the application while those verticals are drained.
   */
  experiments: ExperimentTrpcPorts<TWorkbenchState>;
  /**
   * The filter-field catalogue a stored graph is read back against, and the
   * automation secret redaction a bundled trigger row goes through.
   */
  graphs: GraphTrpcPorts<TFilterField>;
  /** The Enterprise plan gate behind groups, read out of the billing store. */
  group: GroupTrpcPorts;
  /** The verification ceremony that spends the caller's own record. */
  identity: IdentityTrpcPorts;
  /**
   * The project setup rollup the onboarding surfaces render: nine other
   * verticals' evidence plus the project's own two columns, fanned out by the
   * process because no one feature package holds it.
   */
  integrationsChecks: IntegrationsChecksTrpcPorts<TCheckStatus>;
  /**
   * The join-request service, composed over the identity ledger, the
   * membership writer that emits authorization grants, the organization's join
   * settings and the mailer.
   */
  joinRequests: JoinRequestTrpcPorts;
  /**
   * The sign-up ceremony's four follow-ups, plus the questionnaire schema its
   * input is built from.
   *
   * Every one of them is somebody else's: the standard AI tool catalogue is
   * an Enterprise governance capability a core package may not name, the
   * signer's personal workspace is provisioned through the user application
   * that names the person, the first project is created through the process's
   * own project surface so it runs that surface's authorization and audit,
   * and both sign-up notifications are this deployment's marketing traffic.
   * What the organization package keeps is the ceremony itself.
   */
  onboarding: OnboardingTrpcPorts<TSignUpDataSchema>;
  /**
   * The process's database client. One surface takes it directly: the
   * evaluation mount builds its custom-evaluator read on the client rather
   * than on a request context, because that read is the same table scan for
   * every caller.
   */
  prisma: PrismaClient;
  /**
   * The deployment's own answers behind the signed-in person's account: its
   * auth provider and passkey policy, its Auth0 tenant, its password hashing,
   * the account and organization rows the /me screens read, the signup
   * throttle, product analytics and the budget-increase mail. All of it is
   * this process's, none of it the user feature's.
   */
  user: UserTrpcPorts;
  /**
   * One feature, two namespaces, so one entry with the two groups inside it.
   *
   * `lifecycle` answers for `workflow.*`: the copy lineage the workflow
   * service does not read yet, the archive cascade that reaches evaluators,
   * agents and monitors, the cross-project permission probe a copy needs, the
   * model call behind an autogenerated commit message, and the nurturing
   * signal a first workflow fires. `optimization` answers for the studio's
   * own `optimization.*`: the published run endpoint its chat panel calls as
   * the project, and the workflow rows behind the component and evaluator
   * flags, which are not on `UpdateWorkflowCommand`.
   */
  workflows: {
    lifecycle: WorkflowTrpcPorts;
    optimization: WorkflowOptimizationTrpcPorts<TWorkflowVersion, TPublishedComponent>;
  };
}

/**
 * Builds every tRPC surface this package owns against one process's mount.
 *
 * The result is keyed by the namespace each surface answers on, so the caller
 * spreads it into its router record and adds nothing per feature. A surface
 * that is not in here is not mounted — which is the property the audits rely
 * on.
 */
export function createAppTrpcFeatures<
  TContext extends AnalyticsTrpcContext &
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
    WorkflowTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TAnnotationPorts extends AnnotationTrpcPorts,
  TBugReport,
  TBugReportPage,
  TCheckStatus,
  TFilterField extends string,
  TMappingsIn,
  TMappingsOut,
  TPrivacyRule,
  TPrivacySnapshot,
  TReadInput extends AnalyticsReadInput,
  TSignUpDataSchema extends ZodTypeAny,
  TTimeseriesInput extends AnalyticsTimeseriesInput,
  TWorkbenchState,
  TWorkflowVersion,
  TPublishedComponent,
  TTimeseriesInputWire = unknown,
  TReadInputWire = unknown,
>(options: {
  mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPublicMount<TContext, TOptions, TRoot>;
  ports: AppTrpcFeaturePorts<
    TAnnotationPorts,
    TBugReport,
    TBugReportPage,
    TCheckStatus,
    TFilterField,
    TMappingsIn,
    TMappingsOut,
    TPrivacyRule,
    TPrivacySnapshot,
    TReadInput,
    TSignUpDataSchema,
    TTimeseriesInput,
    TWorkbenchState,
    TWorkflowVersion,
    TPublishedComponent,
    TTimeseriesInputWire,
    TReadInputWire
  >;
}) {
  const { mount, ports } = options;

  return {
    // One wire namespace assembled from three packaged transports, exactly as
    // the client has always called it: the charted reads at `analytics.*`, the
    // workbench at `analytics.lwql`, and the saved charts at
    // `analytics.savedWorkbenchCharts`. Merged here rather than at the caller
    // so the whole namespace is one entry in this list, and so nothing outside
    // it can add a fourth door onto the same name.
    analytics: mount.root.mergeRouters(
      createAnalyticsTrpcRouter({ ...mount, ports: ports.analytics.reads }),
      mount.root.router({
        lwql: createLangWatchQLTrpcRouter({ ...mount, ports: ports.analytics.workbench }),
        savedWorkbenchCharts: createSavedWorkbenchChartTrpcRouter({
          ...mount,
          ports: ports.analytics.savedCharts,
        }),
      }),
    ),
    annotation: createAnnotationTrpcRouter({ ...mount, ports: ports.annotation }),
    annotationScore: createAnnotationScoreTrpcRouter(mount),
    apiKey: createApiKeyTrpcRouter({ ...mount, recordAudit: ports.apiKeyAudit }),
    bugReports: createBugReportTrpcRouter({ ...mount, ports: ports.bugReports }),
    dashboards: createDashboardTrpcRouter(mount),
    dataPrivacy: createDataPrivacyTrpcRouter({
      ...mount,
      ports: ports.dataPrivacy,
      checks: ports.dataPrivacyScopeChecks,
    }),
    evaluations: createEvaluationTrpcRouter({
      ...mount,
      prisma: ports.prisma,
      ports: ports.evaluations,
    }),
    experiments: createExperimentTrpcRouter({ ...mount, ports: ports.experiments }),
    // The two export-progress relays. This one surface owns its procedures
    // rather than delegating to a feature package — one relay over a channel
    // the PROCESS owns, distinguished only by the permission each demands —
    // so it takes no ports; see the mount's own docblock. It is in this list
    // because a subscription mounted beside the list would serve traffic from
    // outside every audit that reads it.
    export: createExportTrpcRouter(mount),
    frontDoor: createFrontDoorTrpcRouter({ ...mount, ports: ports.auth }),
    graphs: createGraphTrpcRouter({ ...mount, ports: ports.graphs }),
    group: createGroupTrpcRouter({ ...mount, ports: ports.group }),
    identity: createIdentityTrpcRouter({ ...mount, ports: ports.identity }),
    integrationsChecks: createIntegrationsChecksTrpcRouter({
      ...mount,
      ports: ports.integrationsChecks,
    }),
    joinRequests: createJoinRequestTrpcRouter({ ...mount, ports: ports.joinRequests }),
    // The sign-up ceremony, beside the `organization.createAndAssign` it is
    // built on: same package, same questionnaire schema, same opt-out reason.
    onboarding: createOnboardingTrpcRouter({ ...mount, ports: ports.onboarding }),
    // A procedure rather than a router: the client calls `publicEnv({})` at
    // the root, and giving it a namespace would rename it.
    publicEnv: createPublicEnvTrpcProcedure({ ...mount, ports: ports.auth }),
    // Two namespaces for one feature. `optimization.*` is not a second
    // workflow surface bolted on: those procedures are the optimization
    // studio's, and the name is the one its pages have always called.
    optimization: createWorkflowOptimizationTrpcRouter({
      ...mount,
      ports: ports.workflows.optimization,
    }),
    // The signed-in person's own account. The process merges the Enterprise
    // /me dashboard reads into the same namespace, so `user.*` answers from
    // two owners on one wire name.
    user: createUserTrpcRouter({ ...mount, ports: ports.user }),
    workflow: createWorkflowTrpcRouter({ ...mount, ports: ports.workflows.lifecycle }),
  };
}
