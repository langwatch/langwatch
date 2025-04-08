import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { type Dataset, type DatasetRecord } from "@prisma/client";
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
  download: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .mutation(async ({ input }) => {
      return getFullDataset({
        datasetId: input.datasetId,
        projectId: input.projectId,
        limitMb: null,
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
  limitMb = 5,
}: {
  datasetId: string;
  projectId: string;
  entrySelection?: "first" | "last" | "random" | "all";
  limitMb?: number | null;
}): Promise<
  | (Dataset & {
      datasetRecords: DatasetRecord[];
      truncated?: boolean;
      count: number;
    })
  | null
> => {
  const dataset = await prisma.dataset.findFirst({
    where: { id: datasetId, projectId },
  });

  if (!dataset) {
    return null;
  }

  const count = await prisma.datasetRecord.count({
    where: { datasetId, projectId },
  });

  if (entrySelection === "random" || entrySelection === "last") {
    return {
      ...dataset,
      count,
      datasetRecords: await prisma.datasetRecord.findMany({
        where: { datasetId, projectId },
        orderBy: { createdAt: "asc" },
        take: 1,
        skip:
          entrySelection === "last"
            ? Math.max(count - 1, 0)
            : entrySelection === "random"
            ? Math.floor(Math.random() * count)
            : 0,
      }),
    };
  }

  const truncatedDatasetRecords: DatasetRecord[] = [];
  let truncated = false;
  let totalSize = 0;
  let currentPage = 0;
  const BATCH_SIZE = 500;

  // Fetch records in batches
  while (!truncated) {
    const records = await prisma.datasetRecord.findMany({
      where: { datasetId, projectId },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
      skip: currentPage * BATCH_SIZE,
    });

    if (records.length === 0) break;

    for (const record of records) {
      const recordSize = JSON.stringify(record.entry).length;
      if (!limitMb || totalSize + recordSize < limitMb * 1024 * 1024) {
        truncatedDatasetRecords.push(record);
        totalSize += recordSize;
      } else {
        truncated = true;
        break;
      }
    }

    if (truncated || records.length < BATCH_SIZE) break;
    currentPage++;
  }

  return {
    ...dataset,
    datasetRecords: truncatedDatasetRecords,
    truncated,
    count,
  };
};
