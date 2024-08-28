import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

import { nanoid } from "nanoid";
import slugify from "slugify";
import { datasetRecordFormSchema } from "../../datasets/types.generated";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";

export const datasetRouter = createTRPCRouter({
  upsert: protectedProcedure
    .input(
      z.intersection(
        z.object({
          datasetId: z.string().optional(),
          projectId: z.string(),
        }),
        datasetRecordFormSchema
      )
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      if (input.datasetId) {
        return ctx.prisma.dataset.update({
          where: {
            id: input.datasetId,
            projectId: input.projectId,
          },
          data: {
            name: input.name,
            columnTypes: input.columnTypes,
          },
        });
      } else {
        const slug = slugify(input.name, { lower: true });

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

        return ctx.prisma.dataset.create({
          data: {
            id: nanoid(),
            slug,
            name: input.name,
            projectId: input.projectId,
            columnTypes: input.columnTypes,
          },
        });
      }
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
      await ctx.prisma.dataset.update({
        where: {
          id: input.datasetId,
          projectId: input.projectId,
        },
        data: {
          archivedAt: input.undo ? null : new Date(),
        },
      });

      return { success: true };
    }),
});
