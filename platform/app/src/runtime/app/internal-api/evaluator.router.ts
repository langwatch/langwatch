import type { AuthzPermission } from "@langwatch/authz-contract";
import { EvaluatorTrpcApi, type EvaluatorTrpcPorts } from "@langwatch/evaluator-server";
import type { TRPCContext } from "~/server/api/trpc.context";
import { appTrpcRoot } from "~/server/api/trpc.root";
import {
  auditLogMutations,
  authProtectedProcedure,
  enforcePermissionCheck,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "~/server/api/trpc.runtime-policy";
import { scopeLineageGuard } from "~/server/api/trpc.scope-lineage-middleware";
import { checkDeclaredPermission } from "~/server/app-layer/authz/trpc-middleware";
import type { Session } from "~/server/auth";
import {
  deleteReplicatedWorkflow,
  replicateEvaluatorWorkflow,
} from "./evaluator-workflow-replication";

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that applies process middlewares to a builder whose input generics
 * belong to the feature package, so the policy below needs no `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/**
 * Exactly the chain `protectedProcedure.input(…).permission(…)` builds, handed
 * to the feature so it applies the policy AFTER its own input parser: tRPC runs
 * middlewares in the order they were added, and the declared check reads its
 * scope id from the validated input. `checkDeclaredPermission` carries the
 * authz declaration the router sweep reads, so these procedures stay declared.
 */
const policy =
  (permission: AuthzPermission) =>
  <TProcedure>(procedure: TProcedure): TProcedure =>
    (procedure as unknown as ChainableProcedure)
      .use(tracerMiddleware)
      .use(loggerMiddleware)
      .use(handledErrorMiddleware)
      // Ahead of the check on purpose: a request mixing scope ids across
      // organizations is refused before the declaration can pass on one id
      // while the handler acts on another.
      .use(scopeLineageGuard({ kind: "permission", permission }))
      .use(checkDeclaredPermission({ permission }))
      .use(enforcePermissionCheck)
      .use(auditLogMutations) as unknown as TProcedure;

/** The authenticated request context these ports resolve their work from. */
type AuthenticatedContext = TRPCContext & { session: Session };

type WorkflowScope = { workflowId: string; projectId: string };
type EvaluatorScope = { evaluatorId: string; projectId: string };

/**
 * The workflow and monitor records an evaluator is entangled with. Both belong
 * to other features, so the process reads and writes them here rather than
 * handing the Evaluator package a database client.
 */
const evaluatorPorts: EvaluatorTrpcPorts = {
  findLinkedWorkflow: (ctx: AuthenticatedContext, { workflowId, projectId }: WorkflowScope) =>
    ctx.prisma.workflow.findFirst({
      where: { id: workflowId, projectId, archivedAt: null },
      select: { id: true, name: true },
    }),
  findMonitorsUsingEvaluator: (
    ctx: AuthenticatedContext,
    { evaluatorId, projectId }: EvaluatorScope,
  ) =>
    ctx.prisma.monitor.findMany({
      where: { evaluatorId, projectId },
      select: { id: true, name: true },
    }),
  deleteMonitorsUsingEvaluator: (
    ctx: AuthenticatedContext,
    { evaluatorId, projectId }: EvaluatorScope,
  ) => ctx.prisma.monitor.deleteMany({ where: { evaluatorId, projectId } }),
  archiveLinkedWorkflow: (ctx: AuthenticatedContext, { workflowId, projectId }: WorkflowScope) =>
    ctx.prisma.workflow.update({
      where: { id: workflowId, projectId },
      data: { archivedAt: new Date() },
    }),
  replicateEvaluatorWorkflow,
  deleteReplicatedWorkflow,
};

/** Process transport mount for mixed tRPC batches; feature behaviour is package-owned. */
export const evaluatorsRouter = EvaluatorTrpcApi.create(
  appTrpcRoot,
  { protected: authProtectedProcedure, policy },
  evaluatorPorts,
);
