import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { datasetRecordFormSchema, datasetRecordInputSchema } from "@langwatch/dataset-contract";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { datasetErrorHandler } from "../middleware/dataset-error";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Dataset Router - Manages dataset CRUD operations
 *
 * SLUG BEHAVIOR:
 * - Slugs are auto-generated from dataset names (kebab-case)
 * - Slugs automatically update when dataset names change
 * - Unique constraint: (projectId, slug) at database level
 * - External APIs can use either slug OR id for retrieval
 *
 * ARCHITECTURE:
 * - Router: Thin orchestration layer (input validation, permissions, error mapping)
 * - Service: Business logic (slug generation, migrations, validation)
 * - Repository: Data access layer (Prisma queries)
 */
export const datasetRouter = createTRPCRouter({
  /**
   * Creates a new dataset or updates an existing one.
   * Delegates all business logic to DatasetService.
   */
  upsert: protectedProcedure
    .input(
      z.intersection(
        z.object({
          projectId: z.string(),
          datasetRecords: z.array(datasetRecordInputSchema).optional(),
        }),
        z.union([
          datasetRecordFormSchema.extend({
            datasetId: z.string().optional(),
          }),
          datasetRecordFormSchema
            .omit({
              name: true,
            })
            .extend({
              experimentId: z.string(),
            }),
        ]),
      ),
    )
    .permission("datasets:manage")
    .use(datasetErrorHandler)
    .mutation(async ({ ctx, input }) => {
      const experimentId = "experimentId" in input ? input.experimentId : undefined;
      const experiment = experimentId
        ? await ctx.app.experiments.getById({
            projectId: input.projectId,
            id: experimentId,
          })
        : undefined;
      const name = "name" in input ? input.name : experiment?.name;
      if (!name) {
        throw new Error(`Experiment ${experimentId} has no name`);
      }

      // Delegate all business logic to service
      return await ctx.app.dataset.upsertDataset({
        projectId: input.projectId,
        name,
        columnTypes: input.columnTypes,
        datasetId: "datasetId" in input ? input.datasetId : undefined,
        datasetRecords: input.datasetRecords,
      });
    }),

  /**
   * Validates a dataset name and returns computed slug with availability.
   * Used by frontend for real-time validation.
   */
  validateDatasetName: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        proposedName: z.string(),
        excludeDatasetId: z.string().optional(),
      }),
    )
    .permission("datasets:view")
    .use(datasetErrorHandler)
    .query(async ({ input, ctx }) => {
      return await ctx.app.dataset.validateDatasetName(input);
    }),

  /**
   * Get all datasets for a project.
   * Used by frontend to display all datasets for a project.
   */
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("datasets:view")
    .query(async ({ input, ctx }) => {
      const result = await ctx.app.dataset.listDatasets({
        projectId: input.projectId,
        page: 1,
        limit: 200,
      });
      return result.data;
    }),

  /**
   * Get a dataset by its id.
   * Used by frontend to display a dataset by its id.
   */
  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .permission("datasets:view")
    .query(async ({ input, ctx }) => {
      try {
        return await ctx.app.dataset.getBySlugOrId({
          projectId: input.projectId,
          slugOrId: input.datasetId,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "DatasetNotFoundError") return null;
        throw error;
      }
    }),
  deleteById: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        datasetId: z.string(),
        undo: z.boolean().optional(),
      }),
    )
    .permission("datasets:delete")
    .mutation(async ({ ctx, input }) => {
      if (input.undo) {
        return ctx.app.dataset.restoreDataset({
          datasetId: input.datasetId,
          projectId: input.projectId,
        });
      }
      await ctx.app.dataset.archiveDataset({
        slugOrId: input.datasetId,
        projectId: input.projectId,
      });
      return { success: true as const };
    }),
  updateMapping: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        datasetId: z.string(),
        mapping: z
          .object({
            mapping: z.record(z.string(), z.any()),
            expansions: z.array(z.string()),
          })
          .optional(),
        threadMapping: z
          .object({
            mapping: z.record(z.string(), z.any()),
          })
          .optional(),
      }),
    )
    .permission("datasets:update")
    .mutation(async ({ ctx, input }) => {
      return ctx.app.dataset.updateMapping(input);
    }),
  /**
   * Find next available name for a dataset, given proposed name
   */
  findNextName: protectedProcedure
    .input(z.object({ projectId: z.string(), proposedName: z.string() }))
    .permission("datasets:view")
    .use(datasetErrorHandler)
    .query(async ({ input, ctx }) => {
      return await ctx.app.dataset.findNextAvailableName(input);
    }),
  /**
   * Copy a dataset to a target project.
   * Handles name conflicts by appending a suffix.
   * Copies all records with correct structure.
   */
  copy: protectedProcedure
    .input(
      z.object({
        datasetId: z.string(),
        sourceProjectId: z.string(),
        projectId: z.string(),
      }),
    )
    .permission("datasets:create")
    .use(datasetErrorHandler)
    .mutation(async ({ ctx, input }) => {
      // Check that the user has at least datasets:create permission on the source project
      // (having create permission implies you can view/copy from that project)
      const hasSourcePermission = await probeProjectPermission(
        ctx,
        input.sourceProjectId,
        "datasets:create",
      );

      if (!hasSourcePermission) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You do not have permission to view datasets in the source project",
        });
      }

      return await ctx.app.dataset.copyDataset({
        sourceDatasetId: input.datasetId,
        sourceProjectId: input.sourceProjectId,
        targetProjectId: input.projectId,
      });
    }),
});
