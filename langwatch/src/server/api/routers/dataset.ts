import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { slugify } from "~/utils/slugify";
import { DatasetService } from "../../datasets/dataset.service";
import { datasetErrorHandler } from "../../datasets/middleware";
import {
  datasetRecordFormSchema,
  datasetRecordInputSchema,
} from "../../datasets/types.generated";
import { checkProjectPermission, hasProjectPermission } from "../rbac";
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
    .use(checkProjectPermission("datasets:manage"))
    .use(datasetErrorHandler)
    .mutation(async ({ ctx, input }) => {
      const datasetService = DatasetService.create(ctx.prisma);

      // Delegate all business logic to service
      return await datasetService.upsertDataset({
        projectId: input.projectId,
        name: "name" in input ? input.name : undefined,
        experimentId: "experimentId" in input ? input.experimentId : undefined,
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
    .use(checkProjectPermission("datasets:view"))
    .use(datasetErrorHandler)
    .query(async ({ input, ctx }) => {
      const datasetService = DatasetService.create(ctx.prisma);
      return await datasetService.validateDatasetName(input);
    }),

  /**
   * Get all datasets for a project.
   * Used by frontend to display all datasets for a project.
   */
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("datasets:view"))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const prisma = ctx.prisma;

      const datasets = await prisma.dataset.findMany({
        where: { projectId, archivedAt: null },
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: { datasetRecords: true },
          },
        },
      });

      return datasets;
    }),

  /**
   * Get a dataset by its id.
   * Used by frontend to display a dataset by its id.
   */
  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .use(checkProjectPermission("datasets:view"))
    .query(async ({ input, ctx }) => {
      const { projectId, datasetId } = input;
      const dataset = await ctx.prisma.dataset.findFirst({
        where: { id: datasetId, projectId, archivedAt: null },
      });

      return dataset;
    }),
  deleteById: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        datasetId: z.string(),
        undo: z.boolean().optional(),
      }),
    )
    .use(checkProjectPermission("datasets:delete"))
    .mutation(async ({ ctx, input }) => {
      const datasetName = (
        await ctx.prisma.dataset.findFirst({
          where: {
            id: input.datasetId,
            projectId: input.projectId,
          },
        })
      )?.name;
      const slug = slugify(datasetName ?? "");

      await ctx.prisma.dataset.update({
        where: {
          id: input.datasetId,
          projectId: input.projectId,
        },
        data: {
          slug: input.undo ? slug : `${slug}-archived-${nanoid()}`,
          archivedAt: input.undo ? null : new Date(),
        },
      });

      return { success: true };
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
    .use(checkProjectPermission("datasets:update"))
    .mutation(async ({ ctx, input }) => {
      const { projectId, datasetId, mapping, threadMapping } = input;

      // Get existing dataset to preserve existing mappings
      const existingDataset = await ctx.prisma.dataset.findUnique({
        where: { id: datasetId, projectId },
        select: { mapping: true },
      });

      const existingMapping = (existingDataset?.mapping as any) || {};

      // Merge with existing mappings
      const updatedMapping = {
        ...existingMapping,
        ...(mapping ? { traceMapping: mapping } : {}),
        ...(threadMapping ? { threadMapping } : {}),
      };

      return await ctx.prisma.dataset.update({
        where: { id: datasetId, projectId },
        data: { mapping: updatedMapping },
      });
    }),
  /**
   * Find next available name for a dataset, given proposed name
   */
  findNextName: protectedProcedure
    .input(z.object({ projectId: z.string(), proposedName: z.string() }))
    .use(checkProjectPermission("datasets:view"))
    .use(datasetErrorHandler)
    .query(async ({ input, ctx }) => {
      const datasetService = DatasetService.create(ctx.prisma);
      return await datasetService.findNextAvailableName(
        input.projectId,
        input.proposedName,
      );
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
    .use(checkProjectPermission("datasets:create"))
    .use(datasetErrorHandler)
    .mutation(async ({ ctx, input }) => {
      // Check that the user has at least datasets:create permission on the source project
      // (having create permission implies you can view/copy from that project)
      const hasSourcePermission = await hasProjectPermission(
        ctx,
        input.sourceProjectId,
        "datasets:create",
      );

      if (!hasSourcePermission) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "You do not have permission to view datasets in the source project",
        });
      }

      const datasetService = DatasetService.create(ctx.prisma);
      return await datasetService.copyDataset({
        sourceDatasetId: input.datasetId,
        sourceProjectId: input.sourceProjectId,
        targetProjectId: input.projectId,
      });
    }),
});
