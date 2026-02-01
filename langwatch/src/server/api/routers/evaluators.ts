import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { Workflow } from "../../../optimization_studio/types/dsl";
import { getWorkflowEntryOutputs } from "../../../optimization_studio/utils/workflowFields";
import { EvaluatorService } from "../../evaluators/evaluator.service";
import { enforceLicenseLimit } from "../../license-enforcement";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Evaluator type enum for validation
 */
const evaluatorTypeSchema = z.enum(["evaluator", "workflow"]);

/**
 * Evaluator Router - Manages evaluator CRUD operations
 *
 * Evaluators are reusable evaluation components that can be:
 * - evaluator: Built-in evaluator with custom settings (e.g., langevals/exact_match)
 * - workflow: Custom evaluator from a workflow
 */
export const evaluatorsRouter = createTRPCRouter({
  /**
   * Gets all evaluators for a project with computed fields.
   * Fields include required/optional inputs derived from evaluator type.
   */
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("evaluations:view"))
    .query(async ({ ctx, input }) => {
      const evaluatorService = EvaluatorService.create(ctx.prisma);
      return await evaluatorService.getAllWithFields({
        projectId: input.projectId,
      });
    }),

  /**
   * Gets a single evaluator by ID with computed fields.
   * Fields include required/optional inputs derived from evaluator type.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("evaluations:view"))
    .query(async ({ ctx, input }) => {
      const evaluatorService = EvaluatorService.create(ctx.prisma);
      return await evaluatorService.getByIdWithFields({
        id: input.id,
        projectId: input.projectId,
      });
    }),

  /**
   * Gets a single evaluator by slug
   */
  getBySlug: protectedProcedure
    .input(z.object({ slug: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("evaluations:view"))
    .query(async ({ ctx, input }) => {
      const evaluatorService = EvaluatorService.create(ctx.prisma);
      return await evaluatorService.getBySlug({
        slug: input.slug,
        projectId: input.projectId,
      });
    }),

  /**
   * Creates a new evaluator
   */
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1).max(255),
        type: evaluatorTypeSchema,
        config: z.record(z.unknown()),
        workflowId: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      // Enforce evaluator limit before creation
      await enforceLicenseLimit(ctx, input.projectId, "evaluators");

      // If workflowId is provided, check if an evaluator already exists for this workflow
      if (input.workflowId) {
        const existingEvaluator = await ctx.prisma.evaluator.findFirst({
          where: {
            workflowId: input.workflowId,
            projectId: input.projectId,
            archivedAt: null,
          },
        });

        if (existingEvaluator) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `An evaluator already exists for this workflow: "${existingEvaluator.name}"`,
          });
        }
      }

      const evaluatorService = EvaluatorService.create(ctx.prisma);
      return await evaluatorService.create({
        id: `evaluator_${nanoid()}`,
        projectId: input.projectId,
        name: input.name,
        type: input.type,
        config: input.config as Prisma.InputJsonValue,
        workflowId: input.workflowId,
      });
    }),

  /**
   * Updates an existing evaluator
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        projectId: z.string(),
        name: z.string().min(1).max(255).optional(),
        type: evaluatorTypeSchema.optional(),
        config: z.record(z.unknown()).optional(),
        workflowId: z.string().nullable().optional(),
      }),
    )
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      const evaluatorService = EvaluatorService.create(ctx.prisma);
      return await evaluatorService.update({
        id: input.id,
        projectId: input.projectId,
        data: {
          ...(input.name && { name: input.name }),
          ...(input.type && { type: input.type }),
          ...(input.config && {
            config: input.config as Prisma.InputJsonValue,
          }),
          ...(input.workflowId !== undefined && {
            workflowId: input.workflowId,
          }),
        },
      });
    }),

  /**
   * Gets entities related to an evaluator for cascade archive warning.
   * Returns linked workflow and monitors that would be affected.
   */
  getRelatedEntities: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("evaluations:view"))
    .query(async ({ ctx, input }) => {
      const evaluator = await ctx.prisma.evaluator.findFirst({
        where: {
          id: input.id,
          projectId: input.projectId,
          archivedAt: null,
        },
        select: { id: true, workflowId: true },
      });

      // Find the linked workflow (if any)
      const workflow =
        evaluator?.workflowId
          ? await ctx.prisma.workflow.findFirst({
              where: {
                id: evaluator.workflowId,
                projectId: input.projectId,
                archivedAt: null,
              },
              select: { id: true, name: true },
            })
          : null;

      // Find monitors using this evaluator
      const monitors = await ctx.prisma.monitor.findMany({
        where: {
          evaluatorId: input.id,
          projectId: input.projectId,
        },
        select: { id: true, name: true },
      });

      return { workflow, monitors };
    }),

  /**
   * Archives an evaluator and all related entities in a transaction.
   * - Archives linked workflow
   * - Deletes monitors using this evaluator (hard delete)
   */
  cascadeArchive: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        // 1. Get the evaluator to find linked workflow
        const evaluator = await tx.evaluator.findFirst({
          where: {
            id: input.id,
            projectId: input.projectId,
            archivedAt: null,
          },
          select: { id: true, workflowId: true },
        });

        if (!evaluator) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Evaluator not found",
          });
        }

        // 2. Delete monitors using this evaluator (hard delete)
        const deletedMonitors = await tx.monitor.deleteMany({
          where: {
            evaluatorId: input.id,
            projectId: input.projectId,
          },
        });

        // 3. Archive the evaluator
        const archivedEvaluator = await tx.evaluator.update({
          where: { id: input.id, projectId: input.projectId },
          data: { archivedAt: new Date() },
        });

        // 4. Archive the linked workflow (if any)
        let archivedWorkflow = null;
        if (evaluator.workflowId) {
          archivedWorkflow = await tx.workflow.update({
            where: { id: evaluator.workflowId, projectId: input.projectId },
            data: { archivedAt: new Date() },
          });
        }

        return {
          evaluator: archivedEvaluator,
          archivedWorkflow,
          deletedMonitorsCount: deletedMonitors.count,
        };
      });
    }),

  /**
   * Soft deletes an evaluator
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      const evaluatorService = EvaluatorService.create(ctx.prisma);
      return await evaluatorService.softDelete({
        id: input.id,
        projectId: input.projectId,
      });
    }),

  /**
   * Gets workflow fields for a workflow-based evaluator.
   * Returns the entry node outputs from the linked workflow.
   * These represent the fields that need to be mapped from trace data.
   */
  getWorkflowFields: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("evaluations:view"))
    .query(async ({ ctx, input }) => {
      // Fetch the evaluator with its workflow
      const evaluator = await ctx.prisma.evaluator.findFirst({
        where: {
          id: input.id,
          projectId: input.projectId,
          archivedAt: null,
        },
        include: {
          workflow: {
            include: {
              currentVersion: true,
            },
          },
        },
      });

      if (!evaluator) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Evaluator not found",
        });
      }

      // If not a workflow evaluator, return empty fields
      if (evaluator.type !== "workflow" || !evaluator.workflow) {
        return {
          evaluatorId: evaluator.id,
          evaluatorType: evaluator.type,
          fields: [],
        };
      }

      // Get the workflow DSL from the current version
      const dsl = evaluator.workflow.currentVersion?.dsl as unknown as
        | Workflow
        | undefined;

      // Extract entry node outputs
      const fields = getWorkflowEntryOutputs(dsl);

      return {
        evaluatorId: evaluator.id,
        evaluatorType: evaluator.type,
        workflowId: evaluator.workflowId,
        workflowName: evaluator.workflow.name,
        workflowIcon: (
          evaluator.workflow.currentVersion?.dsl as { icon?: string } | null
        )?.icon,
        fields,
      };
    }),
});
