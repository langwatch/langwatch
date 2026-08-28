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
 * Transport only: gates, input validation and delegation to `MonitorService`.
 *
 * Specs: specs/monitors/replicate-monitor-to-project.feature,
 * specs/monitors/online-evaluation-preconditions.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { EvaluationService } from "@langwatch/evaluation-contract";
import {
  AVAILABLE_EVALUATORS,
  evaluatorsSchema,
  getEvaluatorDefinitions,
  type EvaluatorService,
  type EvaluatorTypes,
} from "@langwatch/evaluator-contract";
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
  type MonitorService,
} from "@langwatch/monitor-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { ZodError } from "zod";

/** The window `getPerformanceForProject` reports, and compares to the one before it. */
const PERFORMANCE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

type MonitorApplication = Readonly<{
  monitors: MonitorService;
  /** Reads the online-evaluation results the performance strip renders. */
  evaluations: EvaluationService;
  /** Rolls back an evaluator this router copied, when the monitor insert fails. */
  evaluators: EvaluatorService;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type MonitorTrpcContext = Readonly<{
  app: MonitorApplication;
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
 * Refuses a monitor whose `checkType` names no evaluator we can run, and a
 * built-in evaluator whose settings do not match its own schema. Workflow,
 * code and custom evaluators carry their settings elsewhere, so only their
 * type is checked.
 */
function validateCheckSettings(checkType: string, parameters: unknown): void {
  // Allow workflow evaluators ("workflow") and code evaluators ("code/{id}")
  const isWorkflowEvaluator = checkType === "workflow";
  const isCodeEvaluator = checkType.startsWith("code/");

  if (
    AVAILABLE_EVALUATORS[checkType as EvaluatorTypes] === undefined &&
    !checkType.startsWith("custom/") &&
    !isWorkflowEvaluator &&
    !isCodeEvaluator
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid checkType",
    });
  }

  // Skip settings validation for workflow, code, and custom evaluators
  // (they don't have schema-based settings)
  if (!checkType.startsWith("custom/") && !isWorkflowEvaluator && !isCodeEvaluator) {
    const checkType_ = checkType as EvaluatorTypes;
    try {
      evaluatorsSchema.shape[checkType_].shape.settings.parse(parameters);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid settings: ${error}`,
        });
      } else {
        throw error;
      }
    }
  }
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
        return ctx.app.monitors.getAllForProject({ projectId });
      }),

      getPerformanceForProject: alsoRequire("analytics:view")(
        policy("evaluations:view")(procedure.input(monitorApiPerformanceInputSchema)),
      ).query(async ({ input, ctx }) => {
        const monitors = await ctx.app.monitors.getAllForProject({
          projectId: input.projectId,
        });

        if (monitors.length === 0) return [];

        const performanceMonitors = monitors.map((monitor) => ({
          id: monitor.id,
          isGuardrail: getEvaluatorDefinitions(monitor.checkType)?.isGuardrail ?? false,
        }));
        const endMs = Date.now();
        const currentStartMs = endMs - PERFORMANCE_PERIOD_MS;
        const previousStartMs = ports.resolvePreviousPeriodStartMs({
          projectId: input.projectId,
          startMs: currentStartMs,
          endMs,
        });
        return ctx.app.evaluations.getMonitorPerformance({
          tenantId: input.projectId,
          monitors: performanceMonitors,
          previousStartMs,
          currentStartMs,
          endMs,
          timeZone: input.timeZone ?? "UTC",
        });
      }),

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
          validateCheckSettings(checkType, parameters);
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

          let source;
          try {
            source = await ctx.app.monitors.getById({
              id: monitorId,
              projectId: sourceProjectId,
            });
          } catch (error) {
            if (!(error instanceof MonitorNotFoundError)) throw error;
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Monitor not found",
            });
          }

          // Evaluator-backed monitors keep their settings (and, for workflow
          // evaluators, the backing workflow) on a separate Evaluator record scoped
          // to the source project. Copy it across so the replica is self-contained
          // in the target project instead of dangling a cross-project reference.
          // Legacy wizard monitors have no evaluator — their settings live inline on
          // the monitor, so copying the monitor fields below is enough.
          let newEvaluatorId: string | null = null;
          let newWorkflowId: string | null = null;
          if (source.evaluatorId) {
            const copiedEvaluator = await ports.copyEvaluatorToProject(ctx, {
              evaluatorId: source.evaluatorId,
              sourceProjectId,
              targetProjectId: projectId,
            });
            newEvaluatorId = copiedEvaluator.id;
            newWorkflowId = copiedEvaluator.workflowId;
          }

          try {
            // Replicas start disabled: a real-time evaluator runs (and bills) on
            // every matching trace, so the user opts in after reviewing it in the
            // target project rather than having it fire the moment it is replicated.
            return await ctx.app.monitors.replicate({
              sourceMonitorId: monitorId,
              sourceProjectId,
              targetProjectId: projectId,
              evaluatorId: newEvaluatorId,
            });
          } catch (createError) {
            // Roll back the evaluator (and its workflow) we copied for this monitor
            // so a failed insert doesn't orphan them in the target project.
            if (newEvaluatorId) {
              await ctx.app.evaluators
                .archive({ id: newEvaluatorId, projectId })
                .catch(() => undefined);
            }
            if (newWorkflowId) {
              await ports
                .deleteReplicatedWorkflow(ctx, { workflowId: newWorkflowId, projectId })
                .catch(() => undefined);
            }
            throw createError;
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
          validateCheckSettings(checkType, parameters);
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
