import { PrismaClient, type Dataset, type DatasetRecord } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  newDatasetEntriesSchema,
  type DatasetRecordEntry,
} from "../../datasets/types";
import { prisma } from "../../db";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { createTRPCRouter, protectedProcedure } from "../trpc";

import { StorageService } from "../../storage";

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
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .query(async ({ input, ctx }) => {
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
        const records = await storageService.getObject(
          input.projectId,
          dataset.id
        );
        const total = records.length;
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
      records = await storageService.getObject(projectId, datasetId);
    } catch (error) {
      if ((error as any).name === "NoSuchKey") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No records found to delete",
        });
      }
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
      JSON.stringify(records)
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
    // Get existing records
    let records: any[] = [];
    try {
      records = await storageService.getObject(projectId, datasetId);
    } catch (error) {
      if ((error as any).name === "NoSuchKey") {
        records = [];
      } else {
        throw error;
      }
    }

    // Find and update the specific record
    const recordIndex = records.findIndex(
      (record: any) => record.id === recordId
    );
    if (recordIndex === -1) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Record not found",
      });
    }

    // Update the record
    records[recordIndex] = {
      ...records[recordIndex],
      entry: updatedRecord,
      updatedAt: new Date().toISOString(),
    };

    // Save back to S3
    await storageService.putObject(
      projectId,
      datasetId,
      JSON.stringify(records)
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

const createDatasetRecords = (
  entries: DatasetRecordEntry[],
  { datasetId, projectId }: { datasetId: string; projectId: string },
  useS3 = false
) => {
  return entries.map((entry, index) => {
    const id = entry.id ?? nanoid();
    const entryWithoutId: Omit<typeof entry, "id"> = { ...entry };
    // @ts-ignore
    delete entryWithoutId.id;

    const record = {
      id,
      entry: entryWithoutId,
      datasetId,
      createdAt: new Date(),
      updatedAt: new Date(),
      projectId,
    };

    if (useS3) {
      return {
        ...record,
        position: (index + 1) * 1000,
      };
    }

    return record;
  });
};

export const createManyDatasetRecords = async ({
  datasetId,
  projectId,
  datasetRecords,
}: {
  datasetId: string;
  projectId: string;
  datasetRecords: DatasetRecordEntry[];
}) => {
  const dataset = await prisma.dataset.findFirst({
    where: { id: datasetId, projectId },
  });

  if (!dataset) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Dataset not found",
    });
  }

  if (dataset.useS3) {
    const recordData = createDatasetRecords(
      datasetRecords,
      {
        datasetId,
        projectId,
      },
      true
    );

    const existingRecords = await storageService.getObject(
      projectId,
      datasetId
    );

    // Combine existing and new records
    const allRecords = [...existingRecords, ...recordData];

    await storageService.putObject(
      projectId,
      datasetId,
      JSON.stringify(allRecords)
    );

    await prisma.dataset.update({
      where: { id: datasetId, projectId },
      data: { s3RecordCount: allRecords.length },
    });

    return { success: true };
  } else {
    const recordData = createDatasetRecords(datasetRecords, {
      datasetId,
      projectId,
    });

    return prisma.datasetRecord.createMany({
      data: recordData as (DatasetRecord & { entry: any })[],
    });
  }
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

  const truncatedDatasetRecords: DatasetRecord[] = [];
  let truncated = false;
  let totalSize = 0;
  let currentPage = 0;
  const BATCH_SIZE = 500;

  if (dataset.useS3) {
    let records: any[] = [];

    try {
      records = await storageService.getObject(projectId, datasetId);

      if (entrySelection !== "all") {
        const count = records.length;
        records = records.filter((_, index) => {
          switch (entrySelection) {
            case "first":
              return index === 0;
            case "last":
              return index === count - 1;
            case "random":
              return index === Math.floor(Math.random() * count);
            default:
              return true;
          }
        });
      }
    } catch (error) {
      console.error(error);

      if ((error as any).name === "NoSuchKey") {
        records = [];
      } else {
        throw error;
      }
    }

    if (entrySelection === "random" || entrySelection === "last") {
      return {
        ...dataset,
        count: records.length,
        datasetRecords: records.slice(
          entrySelection === "last"
            ? -1 // Get the last record
            : entrySelection === "random"
            ? Math.floor(Math.random() * records.length) // Get a random record
            : 0, // Default case (if needed)
          entrySelection === "last"
            ? undefined // No limit for the last record
            : entrySelection === "random"
            ? Math.floor(Math.random() * records.length) + 1 // Get one random record
            : undefined // Default case (if needed)
        ),
      };
    }

    while (!truncated) {
      const allRecords = await storageService.getObject(projectId, datasetId);

      const records = allRecords.slice(
        currentPage * BATCH_SIZE,
        (currentPage + 1) * BATCH_SIZE
      );

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
      count: records.length,
      datasetRecords: records,
    };
  } else {
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
  }
};
