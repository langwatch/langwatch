import { TRPCError } from "@trpc/server";
import { ZodError, z } from "zod";
import { EvaluationExecutionMode } from "~/generated/prisma/client";
import { checkDeclaredPermission } from "~/server/app-layer/authz/trpc-middleware";
import { MonitorNotFoundError } from "@langwatch/monitor-contract";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
  evaluatorsSchema,
} from "../../evaluations/evaluators";
import { getEvaluatorDefinitions } from "../../evaluations/getEvaluator";
import { validatedPreconditionsSchema } from "../../evaluations/preconditionValidation";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { currentVsPreviousDates } from "./analytics/common";
import { copyEvaluatorToProject } from "./copyEvaluatorToProject";

const PERFORMANCE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export const monitorsRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("evaluations:view")
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      return ctx.app.monitors.getAllForProject({ projectId });
    }),
  getPerformanceForProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        timeZone: z.string().min(1).max(100).optional(),
      }),
    )
    .permission("evaluations:view")
    // BOTH permissions are required: the declared check above satisfies the
    // builder, and this second one stacks the same middleware by hand — the
    // one AND-composition site in the codebase.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    .use(checkDeclaredPermission({ permission: "analytics:view" }) as any)
    .query(async ({ input, ctx }) => {
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
      // The previous window comes from the same helper the analytics page
      // uses, so the trend comparison covers the exact same runs a user sees
      // when they open the analytics page for this evaluation.
      const { previousPeriodStartDate } = currentVsPreviousDates({
        projectId: input.projectId,
        startDate: currentStartMs,
        endDate: endMs,
        filters: {},
      });
      return ctx.app.evaluations.getMonitorPerformance({
        tenantId: input.projectId,
        monitors: performanceMonitors,
        previousStartMs: previousPeriodStartDate.getTime(),
        currentStartMs,
        endMs,
        timeZone: input.timeZone ?? "UTC",
      });
    }),
  toggle: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string(), enabled: z.boolean() }))
    .permission("evaluations:update")
    .mutation(async ({ input, ctx }) => {
      return ctx.app.monitors.toggle(input);
    }),
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        checkType: z.string(),
        preconditions: validatedPreconditionsSchema,
        settings: z.record(z.string(), z.json()),
        mappings: z.object({}).passthrough().optional(),
        sample: z.number().min(0).max(1),
        executionMode: z.enum([
          EvaluationExecutionMode.ON_MESSAGE,
          EvaluationExecutionMode.AS_GUARDRAIL,
          EvaluationExecutionMode.MANUALLY,
        ]),
        evaluatorId: z.string().min(1).optional(),
        level: z.enum(["trace", "thread"]).optional(), // Evaluation level: trace or thread
        threadIdleTimeout: z.number().int().positive().nullable().optional(), // Seconds to wait after last message before evaluating thread
      }),
    )
    .permission("evaluations:create")
    .mutation(async ({ input, ctx }) => {
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
    }),
  copy: protectedProcedure
    .input(
      z.object({
        monitorId: z.string(),
        // Target project to replicate into.
        projectId: z.string(),
        // Project the monitor is being copied from.
        sourceProjectId: z.string(),
      }),
    )
    .permission("evaluations:manage")
    .mutation(async ({ input, ctx }) => {
      const { monitorId, projectId, sourceProjectId } = input;
      const hasSourcePermission = await probeProjectPermission(
        ctx,
        sourceProjectId,
        "evaluations:manage",
      );
      if (!hasSourcePermission) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "You do not have permission to manage evaluations in the source project",
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
        const copiedEvaluator = await copyEvaluatorToProject({
          ctx,
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
          await ctx.prisma.workflow
            .deleteMany({ where: { id: newWorkflowId, projectId } })
            .catch(() => undefined);
        }
        throw createError;
      }
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        projectId: z.string(),
        name: z.string(),
        checkType: z.string(),
        preconditions: validatedPreconditionsSchema,
        settings: z.record(z.string(), z.json()),
        mappings: z.object({}).passthrough(),
        sample: z.number().min(0).max(1),
        enabled: z.boolean().optional(),
        executionMode: z.enum([
          EvaluationExecutionMode.ON_MESSAGE,
          EvaluationExecutionMode.AS_GUARDRAIL,
          EvaluationExecutionMode.MANUALLY,
        ]),
        evaluatorId: z.string().min(1).nullable().optional(),
        level: z.enum(["trace", "thread"]).optional(), // Evaluation level: trace or thread
        threadIdleTimeout: z.number().int().positive().nullable().optional(), // Seconds to wait after last message before evaluating thread
      }),
    )
    .permission("evaluations:update")
    .mutation(async ({ input, ctx }) => {
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
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .permission("evaluations:view")
    .query(async ({ input, ctx }) => {
      try {
        return await ctx.app.monitors.getById(input);
      } catch (error) {
        if (!(error instanceof MonitorNotFoundError)) throw error;
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "TraceCheck config not found",
        });
      }
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .permission("evaluations:delete")
    .mutation(async ({ input, ctx }) => {
      return ctx.app.monitors.delete(input);
    }),
  isNameAvailable: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        checkId: z.string().optional(),
        name: z.string(),
      }),
    )
    .permission("evaluations:view")
    .mutation(async ({ input, ctx }) => {
      return ctx.app.monitors.isNameAvailable(input);
    }),
});

const validateCheckSettings = (checkType: string, parameters: any) => {
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
          message: `Invalid settings: ${error as any}`,
        });
      } else {
        throw error;
      }
    }
  }
};
