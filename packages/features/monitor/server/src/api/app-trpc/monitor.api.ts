/**
 * Real-time evaluation monitors over the process's tRPC transport.
 *
 *   getAllForProject:        every monitor configured on the project, with its
 *                            evaluator.
 *   getPerformanceForProject: the last seven days of score / pass-rate for each
 *                            monitor, against the same previous window the
 *                            analytics page compares to.
 *   getById / isNameAvailable: the reads the monitor wizard makes.
 *   create / update / toggle / delete: the wizard's writes.
 *   copy:                    replicates a monitor — and, when it is backed by
 *                            one, its evaluator and that evaluator's workflow —
 *                            into another project the caller also administers.
 *
 * Transport only: gates, input validation and delegation to `MonitorApp`.
 * What a monitor is, and what a write does to one, is the application's; this
 * decides only which status and which words a refusal reaches the wire as.
 *
 * Specs: specs/monitors/replicate-monitor-to-project.feature,
 * specs/monitors/online-evaluation-preconditions.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  monitorApiCopyInputSchema,
  monitorApiCreateInputSchema,
  monitorApiMonitorInputSchema,
  monitorApiNameAvailabilityInputSchema,
  monitorApiPerformanceInputSchema,
  monitorApiProjectInputSchema,
  monitorApiToggleInputSchema,
  monitorApiUpdateInputSchema,
  MonitorNotFoundError,
  type MonitorApiPreconditionsParser,
} from "@langwatch/monitor-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import type { MonitorApp } from "#app/monitor.app";

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them. The REST door, whose
 * family is built per mount, holds {@link MonitorApp} directly.
 */
export type MonitorTrpcContext = Readonly<{
  app: Readonly<{ monitors: MonitorApp }>;
  /** Whether the caller holds `permission` on that project. */
  can(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<boolean>;
}>;

type MonitorTrpcProcedures<
  TContext extends MonitorTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
  /**
   * A SECOND declared permission, stacked after the policy chain — the one
   * AND-composition in the codebase. `getPerformanceForProject` reads both a
   * monitor list and its evaluation results, so it requires
   * `evaluations:view` (the declared check) AND `analytics:view`.
   */
  alsoRequire(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/**
 * The precondition parser the create and update inputs use.
 *
 * Injected because which rules a precondition field accepts is the
 * trace-filter registry's answer, not the monitor's: the registry is what
 * knows that `metadata.value` needs a key and that `traces.name` cannot be a
 * precondition at all. Typed against the monitor contract's own precondition
 * shape, so whatever the process supplies parses to something the service can
 * persist.
 */
/**
 * The process capabilities this transport needs that are not the monitor's own.
 * Each is handed the request context where it resolves per-request state, so
 * the process performs the work exactly as it always did.
 */
type MonitorTrpcPorts = Readonly<{
  preconditionsSchema: MonitorApiPreconditionsParser;
  /**
   * The start of the window the performance trend compares against, from the
   * same helper the analytics page uses — so the comparison covers the exact
   * same runs a user sees when they open analytics for this evaluation.
   */
  resolvePreviousPeriodStartMs(
    input: Readonly<{ projectId: string; startMs: number; endMs: number }>,
  ): number;
  /**
   * Replicates an evaluator, and the workflow backing it, into another
   * project. Owned by the Evaluator feature; a monitor copy needs it because
   * an evaluator-backed monitor would otherwise dangle a cross-project
   * reference.
   */
  copyEvaluatorToProject(
    ctx: MonitorTrpcContext,
    input: Readonly<{ evaluatorId: string; sourceProjectId: string; targetProjectId: string }>,
  ): Promise<Readonly<{ id: string; workflowId: string | null }>>;
  /** Removes a workflow the copy above created, when the monitor insert fails. */
  deleteReplicatedWorkflow(
    ctx: MonitorTrpcContext,
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<void>;
}>;

/**
 * Renders the application's verdict on a check as this transport's refusal.
 *
 * Which checks can run is `MonitorApp.checkFailure`'s answer; the status and
 * the wording are this door's.
 */
function assertRunnableCheck(
  app: MonitorApp,
  input: Readonly<{ checkType: string; parameters: unknown }>,
): void {
  const failure = app.checkFailure(input);
  if (!failure) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      failure.reason === "unknown_check_type"
        ? "Invalid checkType"
        : `Invalid settings: ${failure.cause}`,
  });
}

/**
 * Installs the complete `monitors.*` tRPC surface on a process-owned root. The
 * procedure and the policy are injected by the process so its auth, audit,
 * error, logging and tracing policies wrap every feature procedure
 * consistently.
 */
export class MonitorTrpcApi {
  static create<
    TContext extends MonitorTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: MonitorTrpcProcedures<TContext, TOptions, TRoot>,
    ports: MonitorTrpcPorts,
  ) {
    const { protected: procedure, policy, alsoRequire } = procedures;

    // The process's precondition parser, threaded into the two contract
    // schemas that accept preconditions so the evaluation surface keeps the
    // one definition.
    const createInputSchema = monitorApiCreateInputSchema(ports.preconditionsSchema);
    const updateInputSchema = monitorApiUpdateInputSchema(ports.preconditionsSchema);

    return trpc.router({
      getAllForProject: policy("evaluations:view")(
        procedure.input(monitorApiProjectInputSchema),
      ).query(async ({ input, ctx }) => {
        const { projectId } = input;
        return ctx.app.monitors.list({ projectId });
      }),

      getPerformanceForProject: alsoRequire("analytics:view")(
        policy("evaluations:view")(procedure.input(monitorApiPerformanceInputSchema)),
      ).query(async ({ input, ctx }) =>
        ctx.app.monitors.performanceForProject(
          { projectId: input.projectId, timeZone: input.timeZone },
          ports.resolvePreviousPeriodStartMs,
        ),
      ),

      toggle: policy("evaluations:update")(procedure.input(monitorApiToggleInputSchema)).mutation(
        async ({ input, ctx }) => {
          return ctx.app.monitors.toggle(input);
        },
      ),

      create: policy("evaluations:create")(procedure.input(createInputSchema)).mutation(
        async ({ input, ctx }) => {
          const {
            projectId,
            name,
            checkType,
            preconditions,
            settings: parameters,
            mappings,
            sample,
            executionMode,
            evaluatorId,
            level,
            threadIdleTimeout,
          } = input;
          assertRunnableCheck(ctx.app.monitors, { checkType, parameters });
          return ctx.app.monitors.create({
            projectId,
            name,
            checkType,
            preconditions,
            parameters,
            mappings,
            sample,
            executionMode,
            evaluatorId,
            level,
            threadIdleTimeout,
          });
        },
      ),

      copy: policy("evaluations:manage")(procedure.input(monitorApiCopyInputSchema)).mutation(
        async ({ input, ctx }) => {
          const { monitorId, projectId, sourceProjectId } = input;
          const hasSourcePermission = await ctx.can("evaluations:manage", {
            projectId: sourceProjectId,
          });
          if (!hasSourcePermission) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "You do not have permission to manage evaluations in the source project",
            });
          }

          // What a replication DOES — copying the evaluator across, starting
          // the replica disabled, and rolling both back when the insert fails
          // — is the application's. This door supplies the two process
          // capabilities bound to its own request, and turns a missing source
          // monitor into the status this transport answers with.
          try {
            return await ctx.app.monitors.copy(
              { monitorId, sourceProjectId, targetProjectId: projectId },
              {
                copyEvaluatorToProject: (replicationInput) =>
                  ports.copyEvaluatorToProject(ctx, replicationInput),
                deleteReplicatedWorkflow: (replicationInput) =>
                  ports.deleteReplicatedWorkflow(ctx, replicationInput),
              },
            );
          } catch (error) {
            if (!(error instanceof MonitorNotFoundError)) throw error;
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Monitor not found",
            });
          }
        },
      ),

      update: policy("evaluations:update")(procedure.input(updateInputSchema)).mutation(
        async ({ input, ctx }) => {
          const {
            id,
            projectId,
            name,
            checkType,
            preconditions,
            settings: parameters,
            sample,
            enabled,
            executionMode,
            mappings,
            evaluatorId,
            level,
            threadIdleTimeout,
          } = input;
          assertRunnableCheck(ctx.app.monitors, { checkType, parameters });
          return ctx.app.monitors.update({
            id,
            projectId,
            name,
            checkType,
            preconditions,
            parameters,
            mappings,
            sample,
            enabled,
            executionMode,
            evaluatorId,
            level,
            threadIdleTimeout,
          });
        },
      ),

      getById: policy("evaluations:view")(procedure.input(monitorApiMonitorInputSchema)).query(
        async ({ input, ctx }) => {
          try {
            return await ctx.app.monitors.getById(input);
          } catch (error) {
            if (!(error instanceof MonitorNotFoundError)) throw error;
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "TraceCheck config not found",
            });
          }
        },
      ),

      delete: policy("evaluations:delete")(procedure.input(monitorApiMonitorInputSchema)).mutation(
        async ({ input, ctx }) => {
          return ctx.app.monitors.delete(input);
        },
      ),

      isNameAvailable: policy("evaluations:view")(
        procedure.input(monitorApiNameAvailabilityInputSchema),
      ).mutation(async ({ input, ctx }) => {
        return ctx.app.monitors.isNameAvailable(input);
      }),
    });
  }
}
