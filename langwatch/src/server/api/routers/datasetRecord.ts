import {
  type Dataset,
  type DatasetRecord,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  newDatasetEntriesSchema,
} from "../../datasets/types";
import { prisma } from "../../db";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { createTRPCRouter, protectedProcedure } from "../trpc";

import { StorageService } from "../../storage";
import * as Sentry from "@sentry/nextjs";
import { DatasetService } from "../../datasets/dataset.service";
import { datasetErrorHandler } from "../../datasets/middleware";
const storageService = new StorageService();

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
    .use(datasetErrorHandler)
    .mutation(async ({ ctx, input }) => {
      const datasetService = DatasetService.create(ctx.prisma);
      
      await datasetService.createRecords({
        projectId: input.projectId,
        datasetId: input.datasetId,
        entries: input.entries,
      });

      return { success: true };
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
    .use(datasetErrorHandler)
    .mutation(async ({ ctx, input }) => {
      const datasetService = DatasetService.create(ctx.prisma);

      await datasetService.updateRecord({
        projectId: input.projectId,
        datasetId: input.datasetId,
        recordId: input.recordId,
        entry: input.updatedRecord,
      });

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
      });

      if (!dataset) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Dataset not found",
        });
      }

      if (dataset.useS3) {
        const { records, count } = await storageService.getObject(
          input.projectId,
          dataset.id
        );
        const total = count;
        (dataset as any).datasetRecords = records.slice(0, 5);

        return { dataset, total };
      } else {
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
      }
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
    .use(datasetErrorHandler)
    .mutation(async ({ ctx, input }) => {
      const datasetService = DatasetService.create(ctx.prisma);

      return await datasetService.deleteRecords({
        projectId: input.projectId,
        datasetId: input.datasetId,
        recordIds: input.recordIds,
      });
    }),
});

export const getFullDataset = async ({
  datasetId,
  projectId,
  entrySelection = "all",
  limitMb = 5,
}: {
  datasetId: string;
  projectId: string;
  entrySelection?: "first" | "last" | "random" | "all" | number;
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

  const truncatedDatasetRecords: DatasetRecord[] = [];

  const BATCH_SIZE = 500;

  if (dataset.useS3) {
    let records: any[] = [];
    let truncated = false;
    let totalSize = 0;
    let currentPage = 0;

    try {
      const { records: recordsFromStorage } = await storageService.getObject(
        projectId,
        datasetId
      );
      records = recordsFromStorage;

      while (!truncated) {
        const batch = records.slice(
          currentPage * BATCH_SIZE,
          (currentPage + 1) * BATCH_SIZE
        );

        if (batch.length === 0) break;

        const {
          truncatedRecords: processedRecords,
          truncated: batchTruncated,
          totalSize: newTotalSize,
        } = processBatchedRecords({ records: batch, limitMb, totalSize });

        truncatedDatasetRecords.push(...processedRecords);
        truncated = batchTruncated;
        totalSize = newTotalSize;

        if (truncated || batch.length < BATCH_SIZE) break;
        currentPage++;
      }

      return {
        ...dataset,
        count: records.length,
        datasetRecords: truncatedDatasetRecords,
        truncated,
      };
    } catch (error) {
      Sentry.captureException(error);
      throw error;
    }
  } else {
    const count = await prisma.datasetRecord.count({
      where: { datasetId, projectId },
    });

    if (
      entrySelection === "random" ||
      entrySelection === "last" ||
      typeof entrySelection === "number"
    ) {
      const skip =
        entrySelection === "last"
          ? Math.max(count - 1, 0)
          : entrySelection === "random"
          ? Math.floor(Math.random() * count)
          : typeof entrySelection === "number"
          ? Math.max(0, Math.min(entrySelection, count - 1) - 1)
          : 0;

      return {
        ...dataset,
        count,
        datasetRecords: await prisma.datasetRecord.findMany({
          where: { datasetId, projectId },
          orderBy: { createdAt: "asc" },
          take: 1,
          skip,
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

      const {
        truncatedRecords: processedRecords,
        truncated: batchTruncated,
        totalSize: newTotalSize,
      } = processBatchedRecords({ records, limitMb, totalSize });

      truncatedDatasetRecords.push(...processedRecords);
      truncated = batchTruncated;
      totalSize = newTotalSize;

      if (truncated || records.length < BATCH_SIZE) break;
      currentPage++;
    }

    return {
      ...dataset,
      datasetRecords: truncatedDatasetRecords,
      truncated,
      count,
    };
  }
};

const processBatchedRecords = ({
  records,
  limitMb,
  totalSize = 0,
}: {
  records: DatasetRecord[];
  limitMb: number | null;
  totalSize?: number;
}) => {
  const truncatedRecords: DatasetRecord[] = [];
  let truncated = false;

  for (const record of records) {
    const recordSize = JSON.stringify(record.entry).length;
    if (!limitMb || totalSize + recordSize < limitMb * 1024 * 1024) {
      truncatedRecords.push(record);
      totalSize += recordSize;
    } else {
      truncated = true;
      break;
    }
  }

  return { truncatedRecords, truncated, totalSize };
};
