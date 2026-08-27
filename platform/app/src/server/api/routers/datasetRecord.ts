import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  ChunkTooLargeError,
  DatasetNotFoundError,
  DatasetNotReadyError,
  DatasetTooLargeToExportError,
  DuplicateRecordIdError,
  newDatasetEntriesSchema,
} from "@langwatch/dataset-contract";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const DATASET_EDITOR_READ_LIMIT_MB = 13;

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
  // A full export that would exceed the safe in-heap ceiling is a client-side
  // precondition failure (the dataset must be exported via the streaming path
  // once it ships), not a server fault — surface a clean 4xx, not a 500.
  if (error instanceof DatasetTooLargeToExportError) {
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: error.message,
      cause: error,
    });
  }
  // An edit that would grow a chunk past the cap is a client-side bad request
  // (the new value is too large), not a server fault — clean 4xx, not a 500.
  if (error instanceof ChunkTooLargeError) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }
  // A duplicate caller-supplied row id in the same write is a client conflict
  // (I-PG row-id uniqueness), not a server fault — clean 4xx, not a 500.
  if (error instanceof DuplicateRecordIdError) {
    throw new TRPCError({
      code: "CONFLICT",
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
    .permission("datasets:create")
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.app.dataset.batchCreateRecords({
          slugOrId: input.datasetId,
          projectId: input.projectId,
          entries: input.entries,
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
    .permission("datasets:update")
    .mutation(async ({ ctx, input }) => {
      const { recordId, updatedRecord } = input;

      try {
        return await ctx.app.dataset.upsertRecord({
          recordId,
          updatedRecord,
          slugOrId: input.datasetId,
          projectId: input.projectId,
        });
      } catch (error) {
        return rethrowDatasetNotReadyAsTRPC(error);
      }
    }),
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .permission("datasets:view")
    .query(async ({ input, ctx }) => {
      try {
        const result = await ctx.app.dataset.getDatasetWithRecords({
          slugOrId: input.datasetId,
          projectId: input.projectId,
          // Editor view loads into the browser; give heavy-row datasets a useful
          // window instead of the 5 MB default (~3 rows of base64 images).
          limitMb: DATASET_EDITOR_READ_LIMIT_MB,
        });
        return {
          ...result.dataset,
          datasetRecords: result.records,
          truncated: result.truncated,
        };
      } catch (error) {
        // Defense: a not-ready read surfaces as PRECONDITION_FAILED instead of
        // INTERNAL_SERVER_ERROR (the UI already gates, but downstream consumers
        // rely on a clean 4xx — see useGetDatasetData / useSavedDatasetLoader).
        return rethrowDatasetNotReadyAsTRPC(error);
      }
    }),
  /**
   * One page of a dataset for the editor (classic page N of M). Replaces the
   * editor's whole-dataset `getAll` read — which truncated past a byte cap and
   * silently hid the rest — with a bounded windowed read (s3_jsonl reads only
   * the chunks overlapping the page; PG paginates by skip/take). Total is the
   * PG-authoritative `count`. Editing still works on the visible page because
   * record mutations target each record by its own id.
   */
  listPaginated: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        datasetId: z.string(),
        page: z.number().int().positive().default(1),
        limit: z.number().int().positive().max(200).default(50),
      }),
    )
    .permission("datasets:view")
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.app.dataset.getDatasetPage({
          slugOrId: input.datasetId,
          projectId: input.projectId,
          page: input.page,
          limit: input.limit,
        });
      } catch (error) {
        // Parity with getAll/getFullDataset: an archived/missing dataset reads
        // as null (the editor surfaces "no longer available"), not a 500. A
        // still-preparing dataset maps to PRECONDITION_FAILED like the others.
        if (error instanceof DatasetNotFoundError) return null;
        return rethrowDatasetNotReadyAsTRPC(error);
      }
    }),
  download: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .permission("datasets:view")
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await ctx.app.dataset.getDatasetWithRecords({
          slugOrId: input.datasetId,
          projectId: input.projectId,
          limitMb: null,
        });
        return {
          ...result.dataset,
          datasetRecords: result.records,
          truncated: result.truncated,
        };
      } catch (error) {
        // Defense: a not-ready download surfaces as PRECONDITION_FAILED instead
        // of INTERNAL_SERVER_ERROR, matching getAll/getHead and the REST 425.
        return rethrowDatasetNotReadyAsTRPC(error);
      }
    }),
  getHead: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .permission("datasets:view")
    .query(async ({ input, ctx }) => {
      try {
        const result = await ctx.app.dataset.getDatasetHead({
          slugOrId: input.datasetId,
          projectId: input.projectId,
        });
        return {
          dataset: {
            ...result.dataset,
            datasetRecords: result.records,
          },
          total: result.total,
        };
      } catch (error) {
        // Defense: surface a not-ready read as PRECONDITION_FAILED (4xx) rather
        // than INTERNAL_SERVER_ERROR, matching the REST 425 mapping.
        return rethrowDatasetNotReadyAsTRPC(error);
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
    .permission("datasets:delete")
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.app.dataset.deleteRecords({
          recordIds: input.recordIds,
          slugOrId: input.datasetId,
          projectId: input.projectId,
        });
      } catch (error) {
        return rethrowDatasetNotReadyAsTRPC(error);
      }
    }),
});
