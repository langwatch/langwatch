/**
 * A dataset's entries over a host's tRPC transport.
 *
 *   create:        new entries appended to a dataset.
 *   update:        one entry replaced by id.
 *   deleteMany:    entries removed by id.
 *   getAll:        the whole dataset for the editor, capped by a byte budget.
 *   listPaginated: one page of the editor's classic page N of M.
 *   getHead:       the first entries plus the authoritative total, for previews.
 *   download:      the whole dataset with no byte cap, for export.
 *
 * Reading takes `datasets:view`, appending `datasets:create`, editing
 * `datasets:update`, and removing `datasets:delete`.
 *
 * Transport only: policy, the 4xx mapping below, and delegation to
 * `DatasetApp`.
 *
 * Spec: packages/features/dataset/specs/dataset-service.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import { newDatasetEntriesSchema } from "@langwatch/dataset-contract";
// From the server's own error module, not the contract's. Both declare classes
// with these names; only these are ever thrown — the storage adapters raise
// `ChunkTooLargeError({ byteSize, maxBytes })`, and `instanceof` against the
// contract's same-named class is always false, so every one of these mappings
// used to fall through to a 500.
import {
  ChunkTooLargeError,
  DatasetNotFoundError,
  DatasetNotReadyError,
  DatasetTooLargeToExportError,
  DuplicateRecordIdError,
} from "../../services/errors";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import type { DatasetApp } from "#app/dataset.app";

/**
 * The editor loads into the browser, so it asks for a wider window than the
 * 5 MB default (~3 rows of base64 images). A byte budget is what THIS door
 * asks for, not a fact about the dataset, which is why it stays here rather
 * than on the application both doors share.
 */
const DATASET_EDITOR_READ_LIMIT_MB = 13;

/** The host supplies authentication; authorization arrives as `policy`. */
export type DatasetRecordTrpcContext = Readonly<{ app: Readonly<{ dataset: DatasetApp }> }>;

type DatasetRecordTrpcProcedures<
  TContext extends DatasetRecordTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The host's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The host's tracing, logging, error, scope-lineage, authorization and audit
   * policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

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

const createInputSchema = z.intersection(
  z.object({
    projectId: z.string(),
    datasetId: z.string(),
  }),
  newDatasetEntriesSchema,
);

const updateInputSchema = z.object({
  projectId: z.string(),
  datasetId: z.string(),
  recordId: z.string(),
  updatedRecord: z.record(z.string(), z.any()),
});

const datasetLookupSchema = z.object({ projectId: z.string(), datasetId: z.string() });

const listPaginatedInputSchema = z.object({
  projectId: z.string(),
  datasetId: z.string(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(200).default(50),
});

const deleteManyInputSchema = z.object({
  projectId: z.string(),
  datasetId: z.string(),
  recordIds: z.array(z.string()),
});

/**
 * Installs the complete `datasetRecord.*` tRPC surface on a host-owned root.
 * The procedure and the policy are injected by the host so its auth, audit,
 * error, logging and tracing policies wrap every feature procedure
 * consistently.
 */
export class DatasetRecordTrpcApi {
  static create<
    TContext extends DatasetRecordTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: DatasetRecordTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      create: policy("datasets:create")(procedure.input(createInputSchema)).mutation(
        async ({ ctx, input }) => {
          try {
            return await ctx.app.dataset.batchCreateRecords({
              slugOrId: input.datasetId,
              projectId: input.projectId,
              entries: input.entries,
            });
          } catch (error) {
            return rethrowDatasetNotReadyAsTRPC(error);
          }
        },
      ),

      update: policy("datasets:update")(procedure.input(updateInputSchema)).mutation(
        async ({ ctx, input }) => {
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
        },
      ),

      getAll: policy("datasets:view")(procedure.input(datasetLookupSchema)).query(
        async ({ input, ctx }) => {
          try {
            const result = await ctx.app.dataset.getDatasetWithRecords({
              slugOrId: input.datasetId,
              projectId: input.projectId,
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
        },
      ),

      /**
       * One page of a dataset for the editor (classic page N of M). Replaces the
       * editor's whole-dataset `getAll` read — which truncated past a byte cap and
       * silently hid the rest — with a bounded windowed read (s3_jsonl reads only
       * the chunks overlapping the page; PG paginates by skip/take). Total is the
       * PG-authoritative `count`. Editing still works on the visible page because
       * record mutations target each record by its own id.
       */
      listPaginated: policy("datasets:view")(procedure.input(listPaginatedInputSchema)).query(
        async ({ ctx, input }) => {
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
        },
      ),

      download: policy("datasets:view")(procedure.input(datasetLookupSchema)).mutation(
        async ({ input, ctx }) => {
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
        },
      ),

      getHead: policy("datasets:view")(procedure.input(datasetLookupSchema)).query(
        async ({ input, ctx }) => {
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
        },
      ),

      deleteMany: policy("datasets:delete")(procedure.input(deleteManyInputSchema)).mutation(
        async ({ ctx, input }) => {
          try {
            return await ctx.app.dataset.deleteRecords({
              recordIds: input.recordIds,
              slugOrId: input.datasetId,
              projectId: input.projectId,
            });
          } catch (error) {
            return rethrowDatasetNotReadyAsTRPC(error);
          }
        },
      ),
    });
  }
}
