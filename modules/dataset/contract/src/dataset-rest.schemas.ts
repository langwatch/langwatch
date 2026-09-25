import { resolveRequestBound } from "@langwatch/plans";
/**
 * What `/api/dataset` takes and answers. Stated in the contract so the wire an
 * integrator is typed against is written down once, in the package both the
 * declaration and the published document read.
 */
import { z } from "zod";

import {
  appendStoredObjectToDatasetInputSchema,
  createDatasetFromStoredObjectInputSchema,
  datasetColumnsSchema,
  datasetColumnTypeSchema,
  datasetPaginationSchema,
  datasetRecordSchema,
  datasetSummarySchema,
} from "./dataset.ts";

/**
 * The outer validation shell is the registry's enterprise ceiling; the
 * application refuses batches above the caller's tier value through the
 * entitlement peer.
 */
const DATASET_BATCH_MAX = resolveRequestBound("datasetBatchMax", "ENTERPRISE");

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
    .max(DATASET_BATCH_MAX, `Maximum batch size is ${DATASET_BATCH_MAX} entries`),
});

export const datasetRestDeleteRecordsSchema = z.object({
  recordIds: z
    .array(z.string())
    .min(1, "recordIds is required")
    .max(DATASET_BATCH_MAX, `Maximum ${DATASET_BATCH_MAX} records per batch delete`),
});

/** The legacy spelling of the batch-records body; same grain, older name. */
export const datasetRestLegacyEntriesSchema = z
  .object({
    entries: z
      .array(z.record(z.string(), z.any()))
      .min(1)
      .max(DATASET_BATCH_MAX)
      .meta({
        example: [{ input: "hi", output: "Hello, how can I help you today?" }],
      }),
  })
  .meta({ id: "DatasetPostEntries" });

export const datasetRestSlugOrIdParamsSchema = z.object({ slugOrId: z.string() });
export const datasetRestSlugParamsSchema = z.object({ datasetSlug: z.string() });

/** `PATCH /api/dataset/:slugOrId/records/:recordId`: one record in one dataset. */
export const datasetRestRecordParamsSchema = z.object({
  slugOrId: z.string(),
  recordId: z.string(),
});

/** `PATCH /api/dataset/:slugOrId/records/:recordId`: the entry the record holds now. */
export const datasetRestUpdateRecordSchema = z.object({
  entry: z.record(z.string(), z.any()),
});

/** `POST /api/dataset/imports`: the dataset to build, and the confirmed file it reads. */
export const datasetRestImportSchema = createDatasetFromStoredObjectInputSchema
  .omit({ projectId: true })
  .meta({ id: "DatasetImport" });

/** `POST /api/dataset/:slugOrId/imports`: the confirmed file whose rows are appended. */
export const datasetRestAppendImportSchema = appendStoredObjectToDatasetInputSchema
  .pick({ storedObjectId: true })
  .meta({ id: "DatasetAppendImport" });

/** The deprecated multipart `/upload` routes' text field; the file is the `file` part. */
export const datasetRestUploadFieldsSchema = z.object({ name: z.string().trim().min(1) });
export const datasetRestNoUploadFieldsSchema = z.object({});

/** The deprecated multipart `/attachments` text field: the owning dataset, absent for a draft. */
/** `POST /api/dataset/attachments`: the project the file is stored for, as on main. */
export const datasetRestAttachmentQuerySchema = z.object({
  projectId: z.string().min(1).describe("The project the file is stored for."),
});

export const datasetRestAttachmentFieldsSchema = z.object({
  datasetId: z
    .string()
    .optional()
    .describe("The dataset that owns the file. Omit it while the dataset is still a draft."),
});

/** `POST /api/dataset/upload`: the dataset the posted file became. */
export const datasetRestUploadCreatedSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  columnTypes: datasetColumnsSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  recordsCreated: z.number().int().nonnegative(),
});

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
  data: z.array(datasetSummarySchema.safeExtend({ platformUrl: z.string() })),
  pagination: datasetPaginationSchema,
});

/** `GET /api/dataset/:slugOrId`: the dataset, with every entry inline. */
export const datasetRestDetailResponseSchema = z.object({
  ...datasetRestSummarySchema.shape,
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
