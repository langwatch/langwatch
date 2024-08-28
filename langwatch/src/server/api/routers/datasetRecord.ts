import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { type DatasetRecord } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import {
  newDatasetEntriesSchema,
  type DatasetColumns,
} from "../../datasets/types";
import { nanoid } from "nanoid";

export const datasetRecordRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.intersection(
        z.object({
          projectId: z.string(),
          datasetId: z.string(),
        }),
        newDatasetEntriesSchema
      )
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const dataset = await ctx.prisma.dataset.findFirst({
        where: {
          id: input.datasetId,
          projectId: input.projectId,
        },
      });

      if (!dataset) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Dataset not found",
        });
      }

      const recordData: DatasetRecord[] = [];

      for (const entry of input.entries) {
        const id = entry.id ?? nanoid();
        const entryWithoutId: Omit<typeof entry, "id"> = { ...entry };
        // @ts-ignore
        delete entryWithoutId.id;

        recordData.push({
          id,
          entry: entryWithoutId,
          datasetId: input.datasetId,
          createdAt: new Date(),
          updatedAt: new Date(),
          projectId: input.projectId,
        });
      }

      return ctx.prisma.datasetRecord.createMany({
        data: recordData as (DatasetRecord & { entry: any })[],
      });
    }),
  update: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        datasetId: z.string(),
        recordId: z.string(),
        updatedRecord: z.record(z.string(), z.any()),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const dataset = await ctx.prisma.dataset.findFirst({
        where: {
          id: input.datasetId,
          projectId: input.projectId,
        },
      });

      if (!dataset) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Dataset not found",
        });
      }

      const { recordId, updatedRecord } = input;

      const updatedData: any = {};
      for (const [key, value] of Object.entries(updatedRecord)) {
        const type_ = (dataset.columnTypes as DatasetColumns)[key];
        if (type_ === "string") {
          updatedData[key] = value ?? "";
        } else {
          if (typeof value === "string") {
            try {
              updatedData[key] = JSON.parse(value);
            } catch (e) {
              updatedData[key] = value;
            }
          } else {
            updatedData[key] = value;
          }
        }
      }

      const record = await ctx.prisma.datasetRecord.findUnique({
        where: { id: recordId, projectId: dataset.projectId },
      });

      if (record) {
        await ctx.prisma.datasetRecord.update({
          where: { id: recordId, projectId: dataset.projectId },
          data: {
            entry: updatedData,
          },
        });
      } else {
        await ctx.prisma.datasetRecord.create({
          data: {
            id: recordId,
            entry: updatedData,
            datasetId: input.datasetId,
            projectId: input.projectId,
          },
        });
      }

      return { success: true };
    }),
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const datasets = await prisma.dataset.findFirst({
        where: { id: input.datasetId, projectId: input.projectId },
        include: {
          datasetRecords: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      return datasets;
    }),
  deleteMany: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        datasetId: z.string(),
        recordIds: z.array(z.string()),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const dataset = await ctx.prisma.dataset.findFirst({
        where: {
          id: input.datasetId,
          projectId: input.projectId,
        },
      });

      if (!dataset) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Dataset not found",
        });
      }

      const { count } = await ctx.prisma.datasetRecord.deleteMany({
        where: {
          id: { in: input.recordIds },
          datasetId: input.datasetId,
          projectId: input.projectId,
        },
      });

      if (count === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No matching records found to delete",
        });
      }

      return { deletedCount: count };
    }),
});
