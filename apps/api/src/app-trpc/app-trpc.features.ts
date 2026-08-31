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
import type {
  AnnotationScoreTrpcContext,
  AnnotationTrpcContext,
  AnnotationTrpcPorts,
} from "@langwatch/annotation-server";
import type { TrpcApiMount, TrpcApiPublicMount } from "@langwatch/api/trpc";
import type { ApiKeyTrpcContext } from "@langwatch/api-key-server";
import type { AuthApp, FrontDoorTrpcContext, PublicEnvTrpcContext } from "@langwatch/auth-server";
import type {
  DashboardTrpcContext,
  GraphTrpcContext,
  GraphTrpcPorts,
} from "@langwatch/dashboard-server";
import type { EvaluationTrpcContext } from "@langwatch/evaluation-server";
import type { ExperimentTrpcContext, ExperimentTrpcPorts } from "@langwatch/experiment-server";
import type {
  GroupTrpcContext,
  GroupTrpcPorts,
  JoinRequestTrpcContext,
  JoinRequestTrpcPorts,
} from "@langwatch/organization-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { IdentityTrpcContext, IdentityTrpcPorts } from "@langwatch/user-server";
import type {
  WorkflowOptimizationTrpcContext,
  WorkflowOptimizationTrpcPorts,
  WorkflowTrpcContext,
  WorkflowTrpcPorts,
} from "@langwatch/workflow-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

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
} from "../features/dashboard/dashboard-trpc.mount";
import {
  createEvaluationTrpcRouter,
  type EvaluationMountPorts,
} from "../features/evaluation/evaluation-trpc.mount";
import { createExperimentTrpcRouter } from "../features/experiment/experiment-trpc.mount";
import {
  createGroupTrpcRouter,
  createJoinRequestTrpcRouter,
} from "../features/organization/organization-trpc.mount";
import { createIdentityTrpcRouter } from "../features/user/user-trpc.mount";
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
  TFilterField extends string,
  TMappingsIn,
  TMappingsOut,
  TWorkbenchState,
  TWorkflowVersion,
  TPublishedComponent,
> {
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
   * The composed auth application BOTH signed-out doors answer from — the
   * front door and `publicEnv` beside it. One instance rather than two,
   * because the sign-in mode it resolves is the one ADR-027 source of truth
   * for the whole deployment and the two doors must never disagree.
   */
  auth: AuthApp;
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
   * The join-request service, composed over the identity ledger, the
   * membership writer that emits authorization grants, the organization's join
   * settings and the mailer.
   */
  joinRequests: JoinRequestTrpcPorts;
  /**
   * The process's database client. One surface takes it directly: the
   * evaluation mount builds its custom-evaluator read on the client rather
   * than on a request context, because that read is the same table scan for
   * every caller.
   */
  prisma: PrismaClient;
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
  TContext extends AnnotationTrpcContext &
    AnnotationScoreTrpcContext &
    ApiKeyTrpcContext &
    DashboardTrpcContext &
    EvaluationTrpcContext &
    ExperimentTrpcContext &
    FrontDoorTrpcContext &
    GraphTrpcContext &
    GroupTrpcContext &
    IdentityTrpcContext &
    JoinRequestTrpcContext &
    PublicEnvTrpcContext &
    WorkflowOptimizationTrpcContext &
    WorkflowTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TAnnotationPorts extends AnnotationTrpcPorts,
  TFilterField extends string,
  TMappingsIn,
  TMappingsOut,
  TWorkbenchState,
  TWorkflowVersion,
  TPublishedComponent,
>(options: {
  mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPublicMount<TContext, TOptions, TRoot>;
  ports: AppTrpcFeaturePorts<
    TAnnotationPorts,
    TFilterField,
    TMappingsIn,
    TMappingsOut,
    TWorkbenchState,
    TWorkflowVersion,
    TPublishedComponent
  >;
}) {
  const { mount, ports } = options;

  return {
    annotation: createAnnotationTrpcRouter({ ...mount, ports: ports.annotation }),
    annotationScore: createAnnotationScoreTrpcRouter(mount),
    apiKey: createApiKeyTrpcRouter({ ...mount, recordAudit: ports.apiKeyAudit }),
    dashboards: createDashboardTrpcRouter(mount),
    evaluations: createEvaluationTrpcRouter({
      ...mount,
      prisma: ports.prisma,
      ports: ports.evaluations,
    }),
    experiments: createExperimentTrpcRouter({ ...mount, ports: ports.experiments }),
    frontDoor: createFrontDoorTrpcRouter({ ...mount, ports: ports.auth }),
    graphs: createGraphTrpcRouter({ ...mount, ports: ports.graphs }),
    group: createGroupTrpcRouter({ ...mount, ports: ports.group }),
    identity: createIdentityTrpcRouter({ ...mount, ports: ports.identity }),
    joinRequests: createJoinRequestTrpcRouter({ ...mount, ports: ports.joinRequests }),
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
    workflow: createWorkflowTrpcRouter({ ...mount, ports: ports.workflows.lifecycle }),
  };
}
