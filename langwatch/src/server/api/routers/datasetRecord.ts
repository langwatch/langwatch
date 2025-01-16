import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { PrismaClient, type DatasetRecord } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import {
  newDatasetEntriesSchema,
  type DatasetRecordEntry,
} from "../../datasets/types";
import { nanoid } from "nanoid";
import { prisma } from "../../db";

import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

const USE_S3_STORAGE = true;

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

      return createManyDatasetRecordsS3({
        datasetId: input.datasetId,
        projectId: input.projectId,
        datasetRecords: input.entries,
      });
    }),
  update_3: protectedProcedure
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

      await upsertDatasetRecord({
        recordId,
        updatedRecord,
        datasetId: input.datasetId,
        projectId: input.projectId,
        prisma: ctx.prisma,
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
    .mutation(async ({ ctx, input }) => {
      const { recordId, updatedRecord } = input;

      const dataset = await ctx.prisma.dataset.findFirst({
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
      });
    }),
  getAll_3: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .query(async ({ input }) => {
      return getFullDataset({
        datasetId: input.datasetId,
        projectId: input.projectId,
      });
    }),
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .query(async ({ input }) => {
      return getFullDatasetS3({
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

const updateDatasetRecord = async ({
  recordId,
  updatedRecord,
  datasetId,
  projectId,
  prisma,
}: {
  recordId: string;
  updatedRecord: any;
  datasetId: string;
  projectId: string;
  prisma: PrismaClient;
}) => {
  if (USE_S3_STORAGE) {
    const s3Client = new S3Client({
      endpoint: "http://localhost:9000",
      credentials: {
        accessKeyId: "ktDZf3wZ82N0dPmIkkeq",
        secretAccessKey: "QSNoQSfPBmvThY3zm80KrshAx1JydXfLGQAnB8ym",
      },
      forcePathStyle: true,
    });

    await updateRecordInS3({
      projectId,
      datasetId,
      recordId,
      updatedRecord,
      s3Client,
    });
  } else {
    // Legacy Postgres code - to be removed after migration
    await upsertDatasetRecord({
      recordId,
      updatedRecord,
      datasetId,
      projectId,
      prisma,
    });
  }

  return { success: true };
};

const updateRecordInS3 = async ({
  projectId,
  datasetId,
  recordId,
  updatedRecord,
  s3Client,
}: {
  projectId: string;
  datasetId: string;
  recordId: string;
  updatedRecord: any;
  s3Client: S3Client;
}) => {
  // Get existing records
  let records: any[] = [];
  try {
    const { Body } = await s3Client.send(
      new GetObjectCommand({
        Bucket: "test",
        Key: `datasets/${projectId}/${datasetId}`,
      })
    );

    const content = await Body?.transformToString();
    records = JSON.parse(content ?? "[]");
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
  await s3Client.send(
    new PutObjectCommand({
      Bucket: "test",
      Key: `datasets/${projectId}/${datasetId}`,
      Body: JSON.stringify(records),
      ContentType: "application/json",
    })
  );
};

const upsertDatasetRecord = async ({
  recordId,
  updatedRecord,
  datasetId,
  projectId,
  prisma,
}: {
  recordId: string;
  updatedRecord: any;
  datasetId: string;
  projectId: string;
  prisma: PrismaClient;
}) => {
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
};

const createDatasetRecord = (
  entry: DatasetRecordEntry,
  { datasetId, projectId }: { datasetId: string; projectId: string }
): DatasetRecord => {
  const id = entry.id ?? nanoid();
  const entryWithoutId: Omit<typeof entry, "id"> = { ...entry };
  // @ts-ignore
  delete entryWithoutId.id;

  return {
    id,
    entry: entryWithoutId,
    datasetId,
    createdAt: new Date(),
    updatedAt: new Date(),
    projectId,
  };
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
  const recordData: DatasetRecord[] = datasetRecords.map((entry) =>
    createDatasetRecord(entry, { datasetId, projectId })
  );

  return prisma.datasetRecord.createMany({
    data: recordData as (DatasetRecord & { entry: any })[],
  });
};

export const createManyDatasetRecordsS3 = async ({
  datasetId,
  projectId,
  datasetRecords,
}: {
  datasetId: string;
  projectId: string;
  datasetRecords: DatasetRecordEntry[];
}) => {
  const s3Client = new S3Client({
    // region: process.env.AWS_REGION,
    endpoint: "http://localhost:9000",
    credentials: {
      accessKeyId: "ktDZf3wZ82N0dPmIkkeq",
      secretAccessKey: "QSNoQSfPBmvThY3zm80KrshAx1JydXfLGQAnB8ym",
    },
    forcePathStyle: true,
  });

  const recordData: DatasetRecord[] = datasetRecords.map((entry) =>
    createDatasetRecord(entry, { datasetId, projectId })
  );

  await s3Client.send(
    new PutObjectCommand({
      Bucket: "test",
      Key: `datasets/${projectId}/${datasetId}`, // Single file for all records
      Body: JSON.stringify(recordData), // Save the entire recordData array
      ContentType: "application/json",
    })
  );

  return { success: true };
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

  console.log(dataset);

  return dataset;
};

export const getFullDatasetS3 = async ({
  datasetId,
  projectId,
  entrySelection = "all",
}: {
  datasetId: string;
  projectId: string;
  entrySelection?: "first" | "last" | "random" | "all";
}) => {
  const s3Client = new S3Client({
    endpoint: "http://localhost:9000",
    credentials: {
      accessKeyId: "ktDZf3wZ82N0dPmIkkeq",
      secretAccessKey: "QSNoQSfPBmvThY3zm80KrshAx1JydXfLGQAnB8ym",
    },
    forcePathStyle: true,
  });

  let records: any[] = [];

  try {
    const { Body } = await s3Client.send(
      new GetObjectCommand({
        Bucket: "test",
        Key: `datasets/${projectId}/${datasetId}`,
      })
    );

    const content = await Body?.transformToString();
    records = JSON.parse(content ?? "[]");
  } catch (error) {
    if ((error as any).name === "NoSuchKey") {
      records = [];
    } else {
      throw error;
    }
  }

  const dataset = await prisma.dataset.findFirst({
    where: { id: datasetId, projectId },
  });

  if (!dataset) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Dataset not found",
    });
  }

  return {
    ...dataset,
    datasetRecords: records.map((record: any) => ({
      id: record.id,
      entry: record.entry,
      datasetId: record.datasetId,
      projectId: record.projectId,
      createdAt: record.insertedAt,
      updatedAt: record.insertedAt,
    })),
  };
};
