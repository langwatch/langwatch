import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { Workflow } from "../../../optimization_studio/types/dsl";
import { getWorkflowEntryOutputs } from "../../../optimization_studio/utils/workflowFields";
import { EvaluatorService } from "../../evaluators/evaluator.service";
import { enforceLicenseLimit } from "../../license-enforcement";
import { checkProjectPermission, hasProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { copyWorkflowWithDatasets } from "./workflows";

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
    .use(checkProjectPermission("evaluations:view"))
    .query(async ({ ctx, input }) => {
      const source = await ctx.prisma.evaluator.findFirst({
        where: {
          id: input.evaluatorId,
          projectId: input.projectId,
          archivedAt: null,
        },
      });
      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Evaluator not found",
        });
      }
      const copies = await ctx.prisma.evaluator.findMany({
        where: {
          copiedFromEvaluatorId: input.evaluatorId,
          archivedAt: null,
        },
        select: {
          id: true,
          name: true,
          projectId: true,
          project: {
            select: {
              name: true,
              team: { select: { name: true, organization: { select: { name: true } } } },
            },
          },
        },
      });

      const authorizedCopies = await Promise.all(
        copies.map(async (c) => ({
          copy: c,
          hasPermission: await hasProjectPermission(
            ctx,
            c.projectId,
            "evaluations:view",
          ),
        })),
      ).then((results) =>
        results.filter((r) => r.hasPermission).map((r) => r.copy),
      );

      return authorizedCopies.map((c) => ({
        id: c.id,
        name: c.name,
        projectId: c.projectId,
        fullPath: `${c.project.team.organization.name} / ${c.project.team.name} / ${c.project.name}`,
      }));
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
      }),
    )
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      await enforceLicenseLimit(ctx, input.projectId, "evaluators");

      const hasSourcePermission = await hasProjectPermission(
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

      const source = await ctx.prisma.evaluator.findFirst({
        where: {
          id: input.evaluatorId,
          projectId: input.sourceProjectId,
          archivedAt: null,
        },
        include: {
          workflow: { include: { latestVersion: true } },
        },
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Evaluator not found",
        });
      }

      let newWorkflowId: string | null = null;
      if (source.type === "workflow" && source.workflowId && source.workflow?.latestVersion?.dsl) {
        const { workflowId } = await copyWorkflowWithDatasets({
          ctx,
          workflow: {
            id: source.workflow.id,
            name: source.workflow.name,
            icon: source.workflow.icon,
            description: source.workflow.description,
            latestVersion: source.workflow.latestVersion,
          },
          targetProjectId: input.projectId,
          sourceProjectId: input.sourceProjectId,
          copiedFromWorkflowId: source.workflowId,
        });
        newWorkflowId = workflowId;
      }

      const evaluatorService = EvaluatorService.create(ctx.prisma);
      const copied = await evaluatorService.create({
        id: `evaluator_${nanoid()}`,
        projectId: input.projectId,
        name: source.name,
        type: source.type,
        config:
          source.config === null
            ? Prisma.JsonNull
            : (source.config as Prisma.InputJsonValue),
        workflowId: newWorkflowId ?? undefined,
      });

      await ctx.prisma.evaluator.update({
        where: { id: copied.id },
        data: { copiedFromEvaluatorId: source.id },
      });

      return { ...copied, copiedFromEvaluatorId: source.id };
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
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.prisma.evaluator.findFirst({
        where: {
          id: input.evaluatorId,
          projectId: input.projectId,
          archivedAt: null,
        },
        include: {
          _count: { select: { copiedEvaluators: true } },
          copiedEvaluators: {
            where: { archivedAt: null },
            select: { id: true, projectId: true },
          },
        },
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Evaluator not found",
        });
      }
      if (source.copiedEvaluators.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This evaluator has no copies to push to",
        });
      }

      const copiesToPush = input.copyIds
        ? source.copiedEvaluators.filter((c) => input.copyIds!.includes(c.id))
        : source.copiedEvaluators;

      if (copiesToPush.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No valid copies selected to push to",
        });
      }

      let pushedTo = 0;
      for (const copy of copiesToPush) {
        const hasPermission = await hasProjectPermission(
          ctx,
          copy.projectId,
          "evaluations:manage",
        );
        if (!hasPermission) continue;

        await ctx.prisma.evaluator.update({
          where: { id: copy.id },
          data: {
            name: source.name,
            config:
              source.config === null
                ? Prisma.JsonNull
                : (source.config as Prisma.InputJsonValue),
          },
        });
        pushedTo++;
      }

      return { pushedTo, selectedCopies: copiesToPush.length };
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
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      const copy = await ctx.prisma.evaluator.findFirst({
        where: {
          id: input.evaluatorId,
          projectId: input.projectId,
          archivedAt: null,
        },
        select: { id: true, name: true, copiedFromEvaluatorId: true },
      });

      if (!copy?.copiedFromEvaluatorId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This evaluator is not a copy and has no source to sync from",
        });
      }

      const source = await ctx.prisma.evaluator.findFirst({
        where: { id: copy.copiedFromEvaluatorId, archivedAt: null },
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source evaluator has been deleted",
        });
      }

      const hasSourcePermission = await hasProjectPermission(
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

      await ctx.prisma.evaluator.update({
        where: { id: copy.id },
        data: {
          name: source.name,
          config:
            source.config === null
              ? Prisma.JsonNull
              : (source.config as Prisma.InputJsonValue),
        },
      });

      return { ok: true };
    }),
});
