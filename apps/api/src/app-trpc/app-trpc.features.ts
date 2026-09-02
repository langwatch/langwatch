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
import type { AuthzTrpcContext } from "@langwatch/authz-server";
import type {
  BatchRecordTrpcContext,
  BatchRecordTrpcPorts,
  DatasetRecordTrpcContext,
  DatasetTrpcContext,
  DatasetTrpcPorts,
} from "@langwatch/dataset-server";
import type { FeatureFlagTrpcContext } from "@langwatch/feature-flag-server";
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
import type {
  EvaluatorTrpcContext,
  EvaluatorTrpcPorts,
} from "@langwatch/evaluator-server";
import type { ExperimentTrpcContext, ExperimentTrpcPorts } from "@langwatch/experiment-server";
import type { BugReportTrpcContext, BugReportTrpcPorts } from "@langwatch/ops-server";
import type {
  GroupTrpcContext,
  GroupTrpcPorts,
  JoinRequestTrpcContext,
  JoinRequestTrpcPorts,
  OnboardingTrpcContext,
  OnboardingTrpcPorts,
  PersonalWorkspaceFeaturesTrpcContext,
  TeamTrpcContext,
  TeamTrpcPorts,
} from "@langwatch/organization-server";
import type { PresenceTrpcContext } from "@langwatch/presence-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type {
  HomeTrpcContext,
  HomeTrpcPorts,
  IntegrationsChecksTrpcContext,
  IntegrationsChecksTrpcPorts,
} from "@langwatch/project-server";
import type { PromptTrpcContext, PromptTrpcPorts } from "@langwatch/prompt-server";
import type { RoleBindingTrpcContext, RoleTrpcContext } from "@langwatch/role-server";
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
import { createAuthzTrpcRouter } from "../features/authz/authz-trpc.mount";
import { createFeatureFlagTrpcRouter } from "../features/feature-flag/feature-flag-trpc.mount";
import {
  createBatchRecordTrpcRouter,
  createDatasetRecordTrpcRouter,
  createDatasetTrpcRouter,
} from "../features/dataset/dataset-trpc.mount";
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
import { createEvaluatorTrpcRouter } from "../features/evaluator/evaluator-trpc.mount";
import { createExperimentTrpcRouter } from "../features/experiment/experiment-trpc.mount";
import {
  createExportTrpcRouter,
  type ExportTrpcContext,
} from "../features/export/export-trpc.mount";
import { createBugReportTrpcRouter } from "../features/ops/ops-trpc.mount";
import { createPresenceTrpcRouter } from "../features/presence/presence-trpc.mount";
import {
  createGroupTrpcRouter,
  createJoinRequestTrpcRouter,
  createOnboardingTrpcRouter,
  createPersonalWorkspaceFeaturesTrpcRouter,
  createTeamTrpcRouter,
} from "../features/organization/organization-trpc.mount";
import {
  createHomeTrpcRouter,
  createIntegrationsChecksTrpcRouter,
} from "../features/project/project-trpc.mount";
import {
  createPromptTagTrpcRouter,
  createPromptTrpcRouter,
} from "../features/prompt/prompt-trpc.mount";
import {
  createRoleBindingTrpcRouter,
  createRoleTrpcRouter,
  type RoleTrpcPorts,
} from "../features/role/role-trpc.mount";
import {
  createGithubTrpcRouter,
  type GithubTrpcContext,
  type GithubTrpcMountPorts,
} from "../features/github/github-trpc.mount";
import { createIdentityTrpcRouter, createUserTrpcRouter } from "../features/user/user-trpc.mount";
import {
  createWorkflowOptimizationTrpcRouter,
  createWorkflowTrpcRouter,
} from "../features/workflow/workflow-trpc.mount";
import {
  createAppAgentGroupTrpcFeatures,
  type AnyAppAgentGroupTrpcPorts,
  type AppAgentGroupTrpcContext,
} from "./app-trpc.agent-group";
import {
  createAppGatewayGroupTrpcFeatures,
  type AnyAppGatewayGroupTrpcPorts,
  type AppGatewayGroupTrpcContext,
} from "./app-trpc.gateway-group";
import {
  createAppOrgGroupTrpcFeatures,
  type AnyAppOrgGroupTrpcPorts,
  type AppOrgGroupTrpcContext,
} from "./app-trpc.org-group";
import {
  createAppProductInfraTrpcFeatures,
  type AnyAppProductInfraTrpcPorts,
  type AppProductInfraTrpcContext,
} from "./app-trpc.product-infra";
import {
  createAppTraceGroupTrpcFeatures,
  type AnyAppTraceGroupTrpcPorts,
  type AppTraceGroupTrpcContext,
} from "./app-trpc.trace-group";

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
  TTraceGroup extends AnyAppTraceGroupTrpcPorts = AnyAppTraceGroupTrpcPorts,
  TOrgGroup extends AnyAppOrgGroupTrpcPorts = AnyAppOrgGroupTrpcPorts,
  TAgentGroup extends AnyAppAgentGroupTrpcPorts = AnyAppAgentGroupTrpcPorts,
  TProductInfra extends AnyAppProductInfraTrpcPorts = AnyAppProductInfraTrpcPorts,
  TGatewayGroup extends AnyAppGatewayGroupTrpcPorts = AnyAppGatewayGroupTrpcPorts,
> {
  /**
   * The twenty-one surfaces the AI Gateway and the governance console that
   * steers it are administered through, as one entry.
   *
   * Same reason the trace, organization, agent and product-infrastructure
   * groups are one entry each: they are one graph — a virtual key is minted by
   * the governance console, priced by the budget ledger, delivered on by a
   * webhook endpoint and billed through a subscription — and one entry keeps
   * their ports in {@link AppGatewayGroupTrpcPorts} rather than on this
   * interface, which five other halves of the record also edit.
   */
  gatewayGroup: TGatewayGroup;
  /**
   * The two answers `github.*` reaches that the GitHub feature does not own:
   * which organization a project belongs to, and where a command on the
   * connection is recorded.
   */
  github: GithubTrpcMountPorts;
  /**
   * The three surfaces that answer for a project's own storage, retention and
   * monitoring, as one entry.
   *
   * Same reason the trace, organization and agent groups are one entry each:
   * they are one graph — every one of them is answered from a store the
   * PROCESS operates rather than from a product surface — and one entry keeps
   * their ports in {@link AppProductInfraTrpcPorts} rather than on this
   * interface, which five other halves of the record also edit.
   */
  productInfra: TProductInfra;
  /**
   * The six surfaces an AGENT is written, watched and driven through, as one
   * entry.
   *
   * Same reason the trace and organization groups are one entry each: they are
   * one graph — every one of them either drives an agent or reads what an agent
   * did — and one entry keeps their ports in {@link AppAgentGroupTrpcPorts}
   * rather than on this interface, which five other halves of the record also
   * edit. Three of the browser's ten subscriptions are inside it.
   */
  agentGroup: TAgentGroup;
  /**
   * The nine tenant-administration surfaces, as one entry.
   *
   * Same reason the trace group is one entry: they are one graph — every one
   * of them is a write against the tenant rather than against what the tenant
   * recorded — and one entry keeps their ports in
   * {@link AppOrgGroupTrpcPorts} rather than on this interface, which five
   * other halves of the record also edit.
   */
  orgGroup: TOrgGroup;
  /**
   * The sixteen observability surfaces, as one entry.
   *
   * They are one graph — every one of them either reads the trace application
   * or reads something a trace read is measured against — and one entry is what
   * keeps their twelve type parameters in
   * {@link AppTraceGroupTrpcPorts} rather than on this interface, which four
   * other halves of the record also edit.
   */
  traceGroup: TTraceGroup;
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
   * The two batch-evaluation rollups. The PROCESS's rather than the dataset
   * package's because the table is: `BatchEvaluation` records what an
   * experiment run scored, and the dataset it ran against is a join.
   */
  batchRecord: BatchRecordTrpcPorts<unknown, unknown>;
  /**
   * The support inbox and the audit trail every read of it is written to. The
   * reports themselves are a global table with no tenant column, filed against
   * the product by `langwatch report` and the MCP tool, so the process reads
   * them the way it reads any other back-office resource.
   */
  bugReports: BugReportTrpcPorts<TBugReportPage, TBugReport>;
  /**
   * The permission probe a dataset COPY runs against the SOURCE project, which
   * the declared check on the procedure never covered.
   */
  dataset: DatasetTrpcPorts;
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
   * The workflow behind a WORKFLOW evaluator: its linked row, the monitors
   * running it, and the copy that replicates its graph into another project.
   * A studio graph is Workflow's, and the evaluator package never reaches into
   * one — so all six are the process's.
   */
  evaluators: EvaluatorTrpcPorts;
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
  /**
   * The home screen's recent-activity strip: the process's own audit trail,
   * hydrated one entity at a time so each row carries the name and the link it
   * renders as. Five verticals' rows behind one read, which is why it is the
   * application's rather than the project's.
   */
  home: HomeTrpcPorts;
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
   * The lifecycle signal a project's first prompt fires. The whole port,
   * because everything else `prompts.*` needs is a row read the process
   * answers off `ctx.app.prompts`.
   */
  prompts: PromptTrpcPorts;
  /**
   * The organization probe a role-scoped check runs, the Enterprise plan gate
   * a custom role clears, and the permission vocabulary its entries are parsed
   * against. All three are the deployment's: the role's organization is a row
   * loaded by its id, the plan lives in a billing store, and the vocabulary is
   * the AuthZ registry this deployment evaluates.
   */
  role: RoleTrpcPorts;
  /**
   * The organization-administration probe the two member reads widen or narrow
   * each row with — not a gate, so a caller who cannot manage still gets the
   * team — and the Enterprise plan gate a member list assigning a custom role
   * has to clear.
   */
  team: TeamTrpcPorts;
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
    AuthzTrpcContext &
    BatchRecordTrpcContext &
    BugReportTrpcContext &
    DashboardTrpcContext &
    DataPrivacyTrpcContext &
    DatasetRecordTrpcContext &
    DatasetTrpcContext &
    EvaluationTrpcContext &
    EvaluatorTrpcContext &
    ExperimentTrpcContext &
    ExportTrpcContext &
    FeatureFlagTrpcContext &
    FrontDoorTrpcContext &
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
    PromptTrpcContext &
    RoleBindingTrpcContext &
    RoleTrpcContext &
    PublicEnvTrpcContext &
    SavedWorkbenchChartTrpcContext &
    TeamTrpcContext &
    UserTrpcContext &
    WorkflowOptimizationTrpcContext &
    WorkflowTrpcContext &
    AppAgentGroupTrpcContext &
    AppGatewayGroupTrpcContext &
    GithubTrpcContext &
    AppOrgGroupTrpcContext &
    AppProductInfraTrpcContext &
    AppTraceGroupTrpcContext,
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
  TTraceGroup extends AnyAppTraceGroupTrpcPorts = AnyAppTraceGroupTrpcPorts,
  TOrgGroup extends AnyAppOrgGroupTrpcPorts = AnyAppOrgGroupTrpcPorts,
  TAgentGroup extends AnyAppAgentGroupTrpcPorts = AnyAppAgentGroupTrpcPorts,
  TProductInfra extends AnyAppProductInfraTrpcPorts = AnyAppProductInfraTrpcPorts,
  TGatewayGroup extends AnyAppGatewayGroupTrpcPorts = AnyAppGatewayGroupTrpcPorts,
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
    TReadInputWire,
    TTraceGroup,
    TOrgGroup,
    TAgentGroup,
    TProductInfra,
    TGatewayGroup
  >;
}) {
  const { mount, ports } = options;

  return {
    // The sixteen observability surfaces, spread in whole. They are built by
    // their own module rather than listed here: one graph, one entry, and one
    // place their type parameters live. Both trace subscriptions are inside
    // that spread, which is what makes them watchable over `/api/sse` — the
    // lane resolves a path against a caller built from THIS record.
    ...createAppTraceGroupTrpcFeatures({ mount, ports: ports.traceGroup }),
    // The nine tenant-administration surfaces, spread in whole for the same
    // reason the sixteen above are: one graph, one entry, and one place their
    // ports live. Four of them are Enterprise, and they arrive through the
    // single composition seam a core process may see them through.
    ...createAppOrgGroupTrpcFeatures({ mount, ports: ports.orgGroup }),
    // The six agent surfaces, spread in whole for the same reason. Their three
    // subscriptions are inside that spread, which is what makes them watchable
    // over `/api/sse`: the lane resolves a path against a caller built from
    // THIS record.
    ...createAppAgentGroupTrpcFeatures({ mount, ports: ports.agentGroup }),
    // The three product-infrastructure surfaces, spread in whole for the same
    // reason: one graph — a project's own object store, the retention window
    // it is swept on, and the monitors running beside it — one entry, and one
    // place their parameters live.
    ...createAppProductInfraTrpcFeatures({ mount, ports: ports.productInfra }),
    // The twenty-one AI Gateway and governance-console surfaces, spread in
    // whole for the same reason again: one graph — a virtual key is minted by
    // the console, priced by the budget ledger, delivered on by a webhook
    // endpoint and billed through a subscription — one entry, and one place
    // their ports live. Fifteen of them are Enterprise, and they arrive
    // through the single composition seam a core process may see them through.
    ...createAppGatewayGroupTrpcFeatures({ mount, ports: ports.gatewayGroup }),
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
    // What the caller may do at one scope, as the product reports their own
    // standing back to them. It takes no ports: the answer comes from the same
    // AuthZ service every declared check on this root already runs on, so a
    // second one here would be a second answer to one question.
    authz: createAuthzTrpcRouter(mount),
    batchRecord: createBatchRecordTrpcRouter({ ...mount, ports: ports.batchRecord }),
    bugReports: createBugReportTrpcRouter({ ...mount, ports: ports.bugReports }),
    dashboards: createDashboardTrpcRouter(mount),
    // A project's datasets and the rows inside them: two wire names for one
    // application, because the rows are only reachable through the dataset
    // that holds them and a second service over them could disagree about
    // what one contains.
    dataset: createDatasetTrpcRouter({ ...mount, ports: ports.dataset }),
    datasetRecord: createDatasetRecordTrpcRouter(mount),
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
    // The evaluators a project defines, beside the `evaluations.*` surface
    // that RUNS them. Two namespaces, two owners, one wire: an evaluator is a
    // definition and an evaluation is a result.
    evaluators: createEvaluatorTrpcRouter({ ...mount, ports: ports.evaluators }),
    experiments: createExperimentTrpcRouter({ ...mount, ports: ports.experiments }),
    // The two export-progress relays. This one surface owns its procedures
    // rather than delegating to a feature package — one relay over a channel
    // the PROCESS owns, distinguished only by the permission each demands —
    // so it takes no ports; see the mount's own docblock. It is in this list
    // because a subscription mounted beside the list would serve traffic from
    // outside every audit that reads it.
    export: createExportTrpcRouter(mount),
    frontDoor: createFrontDoorTrpcRouter({ ...mount, ports: ports.auth }),
    // Which rollouts this tenant is inside. No declared-permission policy and
    // no ports, and both are the same decision: every procedure authorizes the
    // exact tenant target it was asked for inside the package's own resolver,
    // which is not the scope id the input carries. The mount declares that
    // claim once for the whole surface.
    featureFlag: createFeatureFlagTrpcRouter(mount),
    graphs: createGraphTrpcRouter({ ...mount, ports: ports.graphs }),
    group: createGroupTrpcRouter({ ...mount, ports: ports.group }),
    // The GitHub App an organization connected, and the pull requests its
    // coding agents opened. Its own entry rather than part of a group: one
    // namespace, two ports, and no graph shared with anything beside it.
    github: createGithubTrpcRouter({ ...mount, ports: ports.github }),
    home: createHomeTrpcRouter({ ...mount, ports: ports.home }),
    identity: createIdentityTrpcRouter({ ...mount, ports: ports.identity }),
    integrationsChecks: createIntegrationsChecksTrpcRouter({
      ...mount,
      ports: ports.integrationsChecks,
    }),
    joinRequests: createJoinRequestTrpcRouter({ ...mount, ports: ports.joinRequests }),
    // The sign-up ceremony, beside the `organization.createAndAssign` it is
    // built on: same package, same questionnaire schema, same opt-out reason.
    onboarding: createOnboardingTrpcRouter({ ...mount, ports: ports.onboarding }),
    // Who else is looking at this project, and where their cursor is. It takes
    // no ports — every answer is read off the request context's own
    // application slice — and it is in this list because two of its four
    // procedures are subscriptions: a namespace mounted beside the record
    // would be callable over `/api/trpc` and un-watchable over `/api/sse`.
    presence: createPresenceTrpcRouter(mount),
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
    // What a PERSONAL workspace may switch on. Same package and same
    // organization directory as `organization.*`, and it takes no ports for
    // the same reason `presence` does not: every answer is read off the
    // request context's own application slice.
    personalWorkspaceFeatures: createPersonalWorkspaceFeaturesTrpcRouter(mount),
    // A project's prompt library and, beside it, the organization's tag
    // catalogue those prompts are labelled from. One package, two wire names,
    // because the catalogue is the ORGANIZATION's and the library is the
    // project's — and only one of them takes a port.
    prompts: createPromptTrpcRouter({ ...mount, ports: ports.prompts }),
    promptTags: createPromptTagTrpcRouter(mount),
    // Custom role definitions, and the bindings that hand them out. Two wire
    // names for one application, because who holds a role and what that role
    // grants are the same question asked from two ends.
    role: createRoleTrpcRouter({ ...mount, ports: ports.role }),
    roleBinding: createRoleBindingTrpcRouter(mount),
    team: createTeamTrpcRouter({ ...mount, ports: ports.team }),
    // The signed-in person's own account. The process merges the Enterprise
    // /me dashboard reads into the same namespace, so `user.*` answers from
    // two owners on one wire name.
    user: createUserTrpcRouter({ ...mount, ports: ports.user }),
    workflow: createWorkflowTrpcRouter({ ...mount, ports: ports.workflows.lifecycle }),
  };
}
