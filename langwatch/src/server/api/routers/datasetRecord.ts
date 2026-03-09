import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { captureException } from "~/utils/posthogErrorCapture";
import { newDatasetEntriesSchema } from "../../datasets/types";
import { prisma } from "../../db";
import { StorageService } from "../../storage";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  createManyDatasetRecords,
  getFullDataset,
} from "./datasetRecord.utils";

export { createManyDatasetRecords, getFullDataset };

const storageService = new StorageService();

export const datasetRecordRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.intersection(
        z.object({
          projectId: z.string(),
          datasetId: z.string(),
        }),
        newDatasetEntriesSchema,
      ),
    )
    .use(checkProjectPermission("datasets:create"))
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
      }),
    )
    .use(checkProjectPermission("datasets:update"))
    .mutation(async ({ ctx, input }) => {
      const { recordId, updatedRecord } = input;

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

      return updateDatasetRecord({
        recordId,
        updatedRecord,
        datasetId: input.datasetId,
        projectId: input.projectId,
        useS3: dataset.useS3,
        prisma,
      });
    }),
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .use(checkProjectPermission("datasets:view"))
    .query(async ({ input }) => {
      return getFullDataset({
        datasetId: input.datasetId,
        projectId: input.projectId,
      });
    }),
  download: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .use(checkProjectPermission("datasets:view"))
    .mutation(async ({ input }) => {
      return getFullDataset({
        datasetId: input.datasetId,
        projectId: input.projectId,
        limitMb: null,
      });
    }),
  getHead: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .use(checkProjectPermission("datasets:view"))
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
          dataset.id,
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
      }),
    )
    .use(checkProjectPermission("datasets:delete"))
    .mutation(async ({ ctx, input }) => {
      const prisma = ctx.prisma;

      const dataset = await prisma.dataset.findFirst({
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

      return deleteManyDatasetRecords({
        recordIds: input.recordIds,
        datasetId: input.datasetId,
        projectId: input.projectId,
        useS3: dataset.useS3,
        prisma,
      });
    }),
});

const deleteManyDatasetRecords = async ({
  recordIds,
  datasetId,
  projectId,
  useS3,
  prisma,
}: {
  recordIds: string[];
  datasetId: string;
  projectId: string;
  useS3: boolean;
  prisma: PrismaClient;
}) => {
  if (useS3) {
    // Get existing records
    let records: any[] = [];
    try {
      const { records: fetchedRecords } = await storageService.getObject(
        projectId,
        datasetId,
      );
      records = fetchedRecords;
    } catch (error) {
      if ((error as any).name === "NoSuchKey") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No records found to delete",
        });
      }
      captureException(error);
      throw error;
    }

    const initialLength = records.length;
    records = records.filter((record) => !recordIds.includes(record.id));

    if (records.length === initialLength) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No matching records found to delete",
      });
    }

    // Save back to S3
    await storageService.putObject(
      projectId,
      datasetId,
      JSON.stringify(records),
    );

    await prisma.dataset.update({
      where: { id: datasetId, projectId },
      data: { s3RecordCount: records.length },
    });

    return { deletedCount: initialLength - records.length };
  } else {
    const { count } = await prisma.datasetRecord.deleteMany({
      where: {
        id: { in: recordIds },
        datasetId,
        projectId,
      },
    });

    if (count === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No matching records found to delete",
      });
    }

    return { deletedCount: count };
  }
};

const updateDatasetRecord = async ({
  recordId,
  updatedRecord,
  datasetId,
  projectId,
  useS3,
  prisma,
}: {
  recordId: string;
  updatedRecord: any;
  datasetId: string;
  projectId: string;
  useS3: boolean;
  prisma: PrismaClient;
}) => {
  if (useS3) {
    const { records } = await storageService.getObject(projectId, datasetId);

    const recordIndex = records.findIndex(
      (record: any) => record.id === recordId,
    );
    if (recordIndex === -1) {
      // Create a new record
      const newRecord = {
        id: recordId,
        entry: updatedRecord,
        datasetId,
        projectId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      records.push(newRecord);
    } else {
      // Update the record
      records[recordIndex] = {
        ...records[recordIndex],
        entry: updatedRecord,
        updatedAt: new Date().toISOString(),
      };
    }

    // Save back to S3
    await storageService.putObject(
      projectId,
      datasetId,
      JSON.stringify(records),
    );

    await prisma.dataset.update({
      where: { id: datasetId, projectId },
      data: { s3RecordCount: records.length },
    });
    return { success: true };
  } else {
    // Legacy Postgres code - to be removed after migration
    const record = await prisma.datasetRecord.findUnique({
      where: { id: recordId, projectId },
    });

    if (record) {
      await prisma.datasetRecord.update({
        where: { id: recordId, projectId },
        data: {
          entry: updatedRecord,
        },
      });
    } else {
      await prisma.datasetRecord.create({
        data: {
          id: recordId,
          entry: updatedRecord,
          datasetId,
          projectId,
        },
      });
    }
  }

  return { success: true };
};

