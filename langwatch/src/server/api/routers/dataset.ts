import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

import { nanoid } from "nanoid";
import slugify from "slugify";
import {
  datasetRecordEntrySchema,
  datasetRecordFormSchema,
} from "../../datasets/types.generated";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { createManyDatasetRecords } from "./datasetRecord";

export const datasetRouter = createTRPCRouter({
  upsert: protectedProcedure
    .input(
      z.intersection(
        z.object({
          datasetId: z.string().optional(),
          projectId: z.string(),
          datasetRecords: z.array(datasetRecordEntrySchema).optional(),
        }),
        datasetRecordFormSchema
      )
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      if (input.datasetId) {
        return await ctx.prisma.dataset.update({
          where: {
            id: input.datasetId,
            projectId: input.projectId,
          },
          data: {
            name: input.name,
            columnTypes: input.columnTypes,
          },
        });
      }

      const slug = slugify(input.name.replace("_", "-"), {
        lower: true,
        strict: true,
      });

      const existingDataset = await ctx.prisma.dataset.findFirst({
        where: {
          slug: slug,
          projectId: input.projectId,
        },
      });

      if (existingDataset) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A dataset with this name already exists.",
        });
      }

      const dataset = await ctx.prisma.dataset.create({
        data: {
          id: nanoid(),
          slug,
          name: input.name,
          projectId: input.projectId,
          columnTypes: input.columnTypes,
        },
      });

      if (input.datasetRecords) {
        await createManyDatasetRecords({
          datasetId: dataset.id,
          projectId: input.projectId,
          datasetRecords: input.datasetRecords,
        });
      }

      return dataset;
    }),
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
          datasetRecords: {
            orderBy: { createdAt: "desc" },
          },
        },
      });

      return datasets;
    }),
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
      const slug = slugify(datasetName?.replace("_", "-") ?? "", {
        lower: true,
        strict: true,
      });

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
});
