/**
 * What `/api/dataset` takes and answers. Stated in the contract so the wire an
 * integrator is typed against is written down once, in the package both the
 * declaration and the published document read.
 */
import { z } from "zod";

import {
  datasetColumnsSchema,
  datasetColumnTypeSchema,
  datasetPaginationSchema,
  datasetRecordSchema,
  datasetSummarySchema,
} from "./dataset.ts";

const columnTypeSchema = z.object({ name: z.string(), type: datasetColumnTypeSchema });

export const datasetRestCreateSchema = z.object({
  name: z.string().min(1, "name is required"),
  columnTypes: z.array(columnTypeSchema).optional().default([]),
});

export const datasetRestUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  columnTypes: z.array(columnTypeSchema).optional(),
});

export const datasetRestPaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

export const datasetRestBatchCreateRecordsSchema = z.object({
  entries: z
    .array(z.record(z.string(), z.any()))
    .min(1, "entries is required")
    .max(1000, "Maximum batch size is 1000 entries"),
});

export const datasetRestDeleteRecordsSchema = z.object({
  recordIds: z
    .array(z.string())
    .min(1, "recordIds is required")
    .max(1000, "Maximum 1000 records per batch delete"),
});

/** The legacy spelling of the batch-records body; same grain, older name. */
export const datasetRestLegacyEntriesSchema = z
  .object({
    entries: z.array(z.record(z.string(), z.any())).meta({
      example: [{ input: "hi", output: "Hello, how can I help you today?" }],
    }),
  })
  .meta({ id: "DatasetPostEntries" });

export const datasetRestSlugOrIdParamsSchema = z.object({ slugOrId: z.string() });
export const datasetRestSlugParamsSchema = z.object({ slug: z.string() });

/** The dataset as this family answers it: the stored row plus its platform URL. */
export const datasetRestSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  columnTypes: datasetColumnsSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  platformUrl: z.string(),
});

/** `GET /api/dataset`: a page of the project's datasets, each with its URL. */
export const datasetRestListResponseSchema = z.object({
  data: z.array(datasetSummarySchema.extend({ platformUrl: z.string() })),
  pagination: datasetPaginationSchema,
});

/** `GET /api/dataset/:slugOrId`: the dataset, with every entry inline. */
export const datasetRestDetailResponseSchema = datasetRestSummarySchema.extend({
  data: z.array(datasetRecordSchema),
});

/** `POST /api/dataset/:slugOrId/records`: the entries that were appended. */
export const datasetRestRecordsCreatedSchema = z.object({
  data: z.array(datasetRecordSchema),
});

/** `POST /api/dataset/:slug/entries`: the legacy family's own acknowledgement. */
export const datasetRestEntriesAddedSchema = z.object({ success: z.literal(true) });

/** `GET /api/dataset/:slugOrId/records`: one page of a dataset's entries. */
export const datasetRestRecordPageSchema = z.object({
  data: z.array(datasetRecordSchema),
  pagination: datasetPaginationSchema,
});

/** `DELETE /api/dataset/:slugOrId`: the dataset that was archived. */
export const datasetRestArchivedSchema = z.object({
  id: z.string(),
  archived: z.literal(true),
});

/** `DELETE /api/dataset/:slugOrId/records`: how many entries were removed. */
export const datasetRestRecordsDeletedSchema = z.object({
  deletedCount: z.number().int().nonnegative(),
});
