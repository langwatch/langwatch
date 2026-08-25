import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod/v4";
import {
  codeEvaluatorConfigSchema,
  evaluatorTypeSchema,
} from "@langwatch/evaluator-contract";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { copyEvaluatorToProject } from "./copyEvaluatorToProject";

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
    .permission("evaluations:view")
    .query(async ({ ctx, input }) => {
      return await ctx.app.evaluators.getAllWithFields({
        projectId: input.projectId,
      });
    }),

  /**
   * Gets a single evaluator by ID with computed fields.
   * Fields include required/optional inputs derived from evaluator type.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .permission("evaluations:view")
    .query(async ({ ctx, input }) => {
      return await ctx.app.evaluators.tryGetByIdWithFields({
        id: input.id,
        projectId: input.projectId,
      });
    }),

  /**
   * Gets a single evaluator by slug
   */
  getBySlug: protectedProcedure
    .input(z.object({ slug: z.string(), projectId: z.string() }))
    .permission("evaluations:view")
    .query(async ({ ctx, input }) => {
      return await ctx.app.evaluators.tryGetBySlug({
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
        // Generated server-side so it's present in audit log args for history lookup
        id: z.string().default(() => `evaluator_${nanoid()}`),
        projectId: z.string(),
        name: z.string().min(1).max(255),
        type: evaluatorTypeSchema,
        config: z.record(z.string(), z.unknown()),
        workflowId: z.string().optional(),
      }),
    )
    .permission("evaluations:manage")
    .mutation(async ({ ctx, input }) => {
      if (input.type === "code") {
        const parsed = codeEvaluatorConfigSchema.safeParse(input.config);
        if (!parsed.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Code evaluators need code, inputs, and outputs",
          });
        }
      }

      // If workflowId is provided, check if an evaluator already exists for this workflow
      if (input.workflowId) {
        const existingEvaluator = await ctx.app.evaluators.tryGetByWorkflow({
          workflowId: input.workflowId,
          projectId: input.projectId,
        });

        if (existingEvaluator) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `An evaluator already exists for this workflow: "${existingEvaluator.name}"`,
          });
        }
      }

      return await ctx.app.evaluators.create({
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        type: input.type,
        config: input.config,
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
        config: z.record(z.string(), z.unknown()).optional(),
        workflowId: z.string().nullable().optional(),
      }),
    )
    .permission("evaluations:manage")
    .mutation(async ({ ctx, input }) => {
      if (input.type === "code" && input.config !== undefined) {
        const parsed = codeEvaluatorConfigSchema.safeParse(input.config);
        if (!parsed.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Code evaluators need code, inputs, and outputs",
          });
        }
      }
      if (input.workflowId) {
      }
      return await ctx.app.evaluators.update({
        id: input.id,
        projectId: input.projectId,
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.type !== undefined && { type: input.type }),
          ...(input.config !== undefined && {
            config: input.config,
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
    .permission("evaluations:view")
    .query(async ({ ctx, input }) => {
      const evaluator = await ctx.app.evaluators.tryGetById({
        id: input.id,
        projectId: input.projectId,
      });

      // Find the linked workflow (if any)
      const workflow = evaluator?.workflowId
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
    .permission("evaluations:manage")
    .mutation(async ({ ctx, input }) => {
      const evaluator = await ctx.app.evaluators.getById({
        id: input.id,
        projectId: input.projectId,
      });
      const deletedMonitors = await ctx.prisma.monitor.deleteMany({
        where: {
          evaluatorId: input.id,
          projectId: input.projectId,
        },
      });
      const archivedEvaluator = await ctx.app.evaluators.archive({
        id: input.id,
        projectId: input.projectId,
      });

      let archivedWorkflow = null;
      if (evaluator.workflowId) {
        archivedWorkflow = await ctx.prisma.workflow.update({
          where: { id: evaluator.workflowId, projectId: input.projectId },
          data: { archivedAt: new Date() },
        });
      }
      return {
        evaluator: archivedEvaluator,
        archivedWorkflow,
        deletedMonitorsCount: deletedMonitors.count,
      };
    }),

  /**
   * Soft deletes an evaluator
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .permission("evaluations:manage")
    .mutation(async ({ ctx, input }) => {
      return await ctx.app.evaluators.archive({
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
    .permission("evaluations:view")
    .query(async ({ ctx, input }) => {
      // Fetch the evaluator first, then scope its workflow to the same project.
      return ctx.app.evaluators.getWorkflowFields(input);
    }),

  /**
   * Get copies of an evaluator (replicas in other projects) for push selection.
   */
  getCopies: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        evaluatorId: z.string(),
      }),
    )
    .permission("evaluations:view")
    .query(async ({ ctx, input }) => {
      const copies = await ctx.app.evaluators.getCopies(input);

      const authorizedCopies = await Promise.all(
        copies.map(async (c) => ({
          copy: c,
          hasPermission: await probeProjectPermission(
            ctx,
            c.projectId,
            "evaluations:view",
          ),
        })),
      ).then((results) => results.filter((r) => r.hasPermission).map((r) => r.copy));

      return authorizedCopies;
    }),

  /**
   * Copy (replicate) an evaluator to another project.
   */
  copy: protectedProcedure
    .input(
      z.object({
        evaluatorId: z.string(),
        projectId: z.string(),
        sourceProjectId: z.string(),
        // Generated server-side so it's present in audit log args for history lookup
        newEvaluatorId: z.string().default(() => `evaluator_${nanoid()}`),
      }),
    )
    .permission("evaluations:manage")
    .mutation(async ({ ctx, input }) => {
      const hasSourcePermission = await probeProjectPermission(
        ctx,
        input.sourceProjectId,
        "evaluations:manage",
      );
      if (!hasSourcePermission) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "You do not have permission to manage evaluations in the source project",
        });
      }

      return await copyEvaluatorToProject({
        ctx,
        evaluatorId: input.evaluatorId,
        sourceProjectId: input.sourceProjectId,
        targetProjectId: input.projectId,
        newEvaluatorId: input.newEvaluatorId,
      });
    }),

  /**
   * Push source evaluator config to selected copies (replicas).
   */
  pushToCopies: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        evaluatorId: z.string(),
        copyIds: z.array(z.string()).optional(),
      }),
    )
    .permission("evaluations:manage")
    .mutation(async ({ ctx, input }) => {
      const copies = await ctx.app.evaluators.getCopies(input);
      const copiesToPush = input.copyIds
        ? copies.filter((copy) => input.copyIds!.includes(copy.id))
        : copies;
      const allowedProjectIds: string[] = [];
      for (const copy of copiesToPush) {
        const hasPermission = await probeProjectPermission(
          ctx,
          copy.projectId,
          "evaluations:manage",
        );
        if (hasPermission) allowedProjectIds.push(copy.projectId);
      }
      return ctx.app.evaluators.pushToCopies({ ...input, allowedProjectIds });
    }),

  /**
   * Sync a copied evaluator from its source.
   */
  syncFromSource: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        evaluatorId: z.string(),
      }),
    )
    .permission("evaluations:manage")
    .mutation(async ({ ctx, input }) => {
      const { source } = await ctx.app.evaluators.getCopySource(input);

      const hasSourcePermission = await probeProjectPermission(
        ctx,
        source.projectId,
        "evaluations:manage",
      );
      if (!hasSourcePermission) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "You do not have permission to read from the source evaluator's project",
        });
      }

      return ctx.app.evaluators.syncFromSource(input);
    }),

  /**
   * Returns recent audit log history for a specific evaluator.
   * Used by the "View History" drawer on the evaluators page.
   */
  getHistory: protectedProcedure
    .input(z.object({ evaluatorId: z.string(), projectId: z.string() }))
    .permission("evaluations:view")
    .query(async ({ ctx, input }) => {
      return ctx.app.evaluators.getHistory({
        evaluatorId: input.evaluatorId,
        projectId: input.projectId,
      });
    }),
});
