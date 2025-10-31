import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

import { nanoid } from "nanoid";
import {
  datasetRecordEntrySchema,
  datasetRecordFormSchema,
} from "../../datasets/types.generated";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { DatasetService } from "../../datasets/dataset.service";
import { datasetErrorHandler } from "../../datasets/middleware";
import { slugify } from "~/utils/slugify";

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
          datasetRecords: z.array(datasetRecordEntrySchema).optional(),
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
        ])
      )
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
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
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
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
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
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
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
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
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
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
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
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
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .use(datasetErrorHandler)
    .query(async ({ input, ctx }) => {
      const datasetService = DatasetService.create(ctx.prisma);
      return await datasetService.findNextAvailableName(
        input.projectId,
        input.proposedName
      );
    }),
});
