import type { Prisma } from "@prisma/client";
import { nanoid } from "nanoid";
import { z } from "zod";
import { EvaluatorService } from "../../evaluators/evaluator.service";
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
   * Gets all evaluators for a project
   */
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("evaluations:view"))
    .query(async ({ ctx, input }) => {
      const evaluatorService = EvaluatorService.create(ctx.prisma);
      return await evaluatorService.getAll({ projectId: input.projectId });
    }),

  /**
   * Gets a single evaluator by ID
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("evaluations:view"))
    .query(async ({ ctx, input }) => {
      const evaluatorService = EvaluatorService.create(ctx.prisma);
      return await evaluatorService.getById({
        id: input.id,
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
});
