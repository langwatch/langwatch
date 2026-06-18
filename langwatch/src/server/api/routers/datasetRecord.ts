import type { Dataset, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import {
  deleteS3JsonlRecords,
  editS3JsonlRecord,
} from "../../datasets/dataset-mutations";
import { DatasetNotReadyError } from "../../datasets/errors";
import { stripNullBytes } from "../../datasets/sanitize";
import { newDatasetEntriesSchema } from "../../datasets/types";
import { prisma } from "../../db";
import { StorageService } from "../../storage";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  createManyDatasetRecords,
  getFullDataset,
  readDatasetHeadS3Jsonl,
} from "./datasetRecord.utils";

export { createManyDatasetRecords, getFullDataset };

const storageService = new StorageService();

/**
 * m5: surface a not-ready s3_jsonl write (I-READY) as a 4xx `PRECONDITION_FAILED`
 * tRPC error rather than letting the plain `DatasetNotReadyError` fall through as
 * INTERNAL_SERVER_ERROR. Mirrors the REST layer's 425 mapping — a write to a
 * still-preparing dataset is a client-precondition failure, not a server fault.
 * Re-throws anything else unchanged.
 */
const rethrowDatasetNotReadyAsTRPC = (error: unknown): never => {
  if (error instanceof DatasetNotReadyError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
      cause: error,
    });
  }
  throw error;
};

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

      try {
        return await createManyDatasetRecords({
          datasetId: input.datasetId,
          projectId: input.projectId,
          datasetRecords: input.entries,
        });
      } catch (error) {
        return rethrowDatasetNotReadyAsTRPC(error);
      }
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

      try {
        return await updateDatasetRecord({
          recordId,
          updatedRecord,
          datasetId: input.datasetId,
          projectId: input.projectId,
          dataset,
          prisma,
        });
      } catch (error) {
        return rethrowDatasetNotReadyAsTRPC(error);
      }
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

      // ADR-032 Decision 6 / I-READY: s3_jsonl reads the first chunk only for
      // the head preview, gated on `status='ready'`. Routed independently of the
      // dead single-blob `useS3` path.
      if (dataset.contentLayout === "s3_jsonl") {
        const { records, total } = await readDatasetHeadS3Jsonl({
          dataset,
          projectId: input.projectId,
        });
        (dataset as any).datasetRecords = records;

        return { dataset, total };
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

      try {
        return await deleteManyDatasetRecords({
          recordIds: input.recordIds,
          datasetId: input.datasetId,
          projectId: input.projectId,
          dataset,
          prisma,
        });
      } catch (error) {
        return rethrowDatasetNotReadyAsTRPC(error);
      }
    }),
});

const deleteManyDatasetRecords = async ({
  recordIds,
  datasetId,
  projectId,
  dataset,
  prisma,
}: {
  recordIds: string[];
  datasetId: string;
  projectId: string;
  dataset: Dataset;
  prisma: PrismaClient;
}) => {
  // ADR-032 rung 6b: s3_jsonl rows live in chunk objects (I-PG); a delete
  // rewrites the affected chunk(s) without the removed rows and recomputes the
  // offset index, under the per-dataset advisory lock (Decision 9). Replaces the
  // dead single-blob `useS3` path below for the new layout.
  if (dataset.contentLayout === "s3_jsonl") {
    const { deleted } = await deleteS3JsonlRecords({
      prisma,
      dataset,
      projectId,
      recordIds,
    });
    if (deleted === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No matching records found to delete",
      });
    }
    return { deletedCount: deleted };
  }

  if (dataset.useS3) {
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
      captureException(toError(error));
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
  dataset,
  prisma,
}: {
  recordId: string;
  updatedRecord: any;
  datasetId: string;
  projectId: string;
  dataset: Dataset;
  prisma: PrismaClient;
}) => {
  // Strip Postgres-incompatible U+0000 null bytes from any user-supplied
  // strings before persisting (Postgres error 22P05). Applied for both
  // S3 and Postgres paths so the stored entry is consistent regardless
  // of storage backend.
  const sanitisedRecord = stripNullBytes(updatedRecord);

  // ADR-032 rung 6b: an s3_jsonl edit locates the row by id, rewrites only its
  // chunk in place (or appends if the id is new), under the per-dataset advisory
  // lock (Decision 9). Replaces the dead single-blob `useS3` path below for the
  // new layout.
  if (dataset.contentLayout === "s3_jsonl") {
    await editS3JsonlRecord({
      prisma,
      dataset,
      projectId,
      recordId,
      entry: sanitisedRecord,
    });
    return { success: true };
  }

  if (dataset.useS3) {
    const { records } = await storageService.getObject(projectId, datasetId);

    const recordIndex = records.findIndex(
      (record: any) => record.id === recordId,
    );
    if (recordIndex === -1) {
      // Create a new record
      const newRecord = {
        id: recordId,
        entry: sanitisedRecord,
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
        entry: sanitisedRecord,
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
          entry: sanitisedRecord as any,
        },
      });
    } else {
      await prisma.datasetRecord.create({
        data: {
          id: recordId,
          entry: sanitisedRecord as any,
          datasetId,
          projectId,
        },
      });
    }
  }

  return { success: true };
};
