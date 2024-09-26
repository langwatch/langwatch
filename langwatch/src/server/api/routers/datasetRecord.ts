import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { type DatasetRecord } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import {
  newDatasetEntriesSchema,
  type DatasetRecordEntry,
} from "../../datasets/types";
import { nanoid } from "nanoid";
import { prisma } from "../../db";

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

      return createManyDatasetRecords({
        datasetId: input.datasetId,
        projectId: input.projectId,
        datasetRecords: input.entries,
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

      const record = await ctx.prisma.datasetRecord.findUnique({
        where: { id: recordId, projectId: dataset.projectId },
      });

      if (record) {
        await ctx.prisma.datasetRecord.update({
          where: { id: recordId, projectId: dataset.projectId },
          data: {
            entry: updatedRecord,
          },
        });
      } else {
        await ctx.prisma.datasetRecord.create({
          data: {
            id: recordId,
            entry: updatedRecord,
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
    .query(async ({ input }) => {
      return getFullDataset({
        datasetId: input.datasetId,
        projectId: input.projectId,
      });
    }),
  getHead: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const dataset = await prisma.dataset.findFirst({
        where: { id: input.datasetId, projectId: input.projectId },
        include: {
          datasetRecords: {
            orderBy: { createdAt: "asc" },
            take: 5,
          },
        },
      });

      const total = await prisma.datasetRecord.count({
        where: { datasetId: input.datasetId, projectId: input.projectId },
      });

      return { dataset, total };
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

export const createManyDatasetRecords = async ({
  datasetId,
  projectId,
  datasetRecords,
}: {
  datasetId: string;
  projectId: string;
  datasetRecords: DatasetRecordEntry[];
}) => {
  const recordData: DatasetRecord[] = [];

  for (const entry of datasetRecords) {
    const id = entry.id ?? nanoid();
    const entryWithoutId: Omit<typeof entry, "id"> = { ...entry };
    // @ts-ignore
    delete entryWithoutId.id;

    recordData.push({
      id,
      entry: entryWithoutId,
      datasetId,
      createdAt: new Date(),
      updatedAt: new Date(),
      projectId,
    });
  }

  return prisma.datasetRecord.createMany({
    data: recordData as (DatasetRecord & { entry: any })[],
  });
};

export const getFullDataset = async ({
  datasetId,
  projectId,
  entrySelection = "all",
}: {
  datasetId: string;
  projectId: string;
  entrySelection?: "first" | "last" | "random" | "all";
}) => {
  let count = 0;
  if (entrySelection === "random" || entrySelection === "last") {
    count = await prisma.datasetRecord.count({
      where: { datasetId, projectId },
    });
  }

  const dataset = await prisma.dataset.findFirst({
    where: { id: datasetId, projectId },
    include: {
      datasetRecords: {
        orderBy: { createdAt: "asc" },
        take: entrySelection === "all" ? undefined : 1,
        skip:
          entrySelection === "last"
            ? Math.max(count - 1, 0)
            : entrySelection === "random"
            ? Math.floor(Math.random() * count)
            : 0,
      },
    },
  });

  return dataset;
};
