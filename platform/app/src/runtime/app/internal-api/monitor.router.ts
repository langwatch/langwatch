import type { AuthzPermission } from "@langwatch/authz-contract";
import { EvaluatorReplicationApi } from "@langwatch/evaluator-server";
import { MonitorTrpcApi } from "@langwatch/monitor-server";
import { currentVsPreviousDates } from "~/server/api/currentVsPreviousDates";
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
import { validatedPreconditionsSchema } from "~/server/evaluations/preconditionValidation";
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

/**
 * A SECOND declared permission stacked after the policy chain above. BOTH are
 * required: the declared check satisfies the builder, and this one stacks the
 * same middleware by hand — the one AND-composition site in the codebase.
 */
const alsoRequire =
  (permission: AuthzPermission) =>
  <TProcedure>(procedure: TProcedure): TProcedure =>
    (procedure as unknown as ChainableProcedure).use(
      checkDeclaredPermission({ permission }),
    ) as unknown as TProcedure;

/** The authenticated request context these ports resolve their work from. */
type AuthenticatedContext = TRPCContext & { session: Session };

/** Copying a monitor's evaluator, bound to one request's context. */
const replicationPorts = (ctx: AuthenticatedContext) => ({
  replicateEvaluatorWorkflow: (input: {
    workflowId: string;
    sourceProjectId: string;
    targetProjectId: string;
  }) => replicateEvaluatorWorkflow(ctx, input),
  deleteReplicatedWorkflow: (input: { workflowId: string; projectId: string }) =>
    deleteReplicatedWorkflow(ctx, input),
});

/** Process transport mount for mixed tRPC batches; feature behaviour is package-owned. */
export const monitorsRouter = MonitorTrpcApi.create(
  appTrpcRoot,
  { protected: authProtectedProcedure, policy, alsoRequire },
  {
    preconditionsSchema: validatedPreconditionsSchema,
    // The previous window comes from the same helper the analytics page uses,
    // so the trend comparison covers the exact same runs a user sees when they
    // open the analytics page for this evaluation.
    resolvePreviousPeriodStartMs: ({ projectId, startMs, endMs }) =>
      currentVsPreviousDates({
        projectId,
        startDate: startMs,
        endDate: endMs,
        filters: {},
      }).previousPeriodStartDate.getTime(),
    copyEvaluatorToProject: (
      ctx: AuthenticatedContext,
      input: { evaluatorId: string; sourceProjectId: string; targetProjectId: string },
    ) =>
      EvaluatorReplicationApi.create(replicationPorts(ctx)).copyToProject({
        evaluators: ctx.app.evaluators,
        ...input,
      }),
    deleteReplicatedWorkflow,
  },
);
