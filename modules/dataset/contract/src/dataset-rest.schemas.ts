import type { Named } from "@langwatch/module";
import { resolveRequestBound } from "@langwatch/plans";
/**
 * What `/api/dataset` takes and answers. Stated in the contract so the wire an
 * integrator is typed against is written down once, in the package both the
 * declaration and the published document read.
 */
import {
  storedObjectByteLengthSchema,
  storedObjectFilenameSchema,
  storedObjectMediaTypeSchema,
} from "@langwatch/stored-object-contract";
import { z } from "zod";

import {
  appendStoredObjectToDatasetInputSchema,
  createDatasetFromStoredObjectInputSchema,
  DATASET_PAGE_LIMIT_MAX,
  datasetColumnsSchema,
  datasetColumnTypeSchema,
  datasetPaginationSchema,
  datasetRecordSchema,
} from "./dataset.ts";

/**
 * The outer validation shell is the registry's enterprise ceiling; the
 * application refuses batches above the caller's tier value through the
 * entitlement peer.
 */
const DATASET_BATCH_MAX = resolveRequestBound("datasetBatchMax", "ENTERPRISE");

const columnTypeSchema = z.object({ name: z.string(), type: datasetColumnTypeSchema });

const datasetRestCreateSchemaDefinition = z.object({
  name: z.string().min(1, "name is required"),
  columnTypes: z.array(columnTypeSchema).optional().default([]),
});
export interface DatasetRestCreateSchema extends Named<typeof datasetRestCreateSchemaDefinition> {}
export const datasetRestCreateSchema: DatasetRestCreateSchema = datasetRestCreateSchemaDefinition;

const datasetRestUpdateSchemaDefinition = z.object({
  name: z.string().min(1).optional(),
  columnTypes: z.array(columnTypeSchema).optional(),
});
export interface DatasetRestUpdateSchema extends Named<typeof datasetRestUpdateSchemaDefinition> {}
export const datasetRestUpdateSchema: DatasetRestUpdateSchema = datasetRestUpdateSchemaDefinition;

const datasetRestPaginationQuerySchemaDefinition = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(DATASET_PAGE_LIMIT_MAX).optional().default(50),
});
export interface DatasetRestPaginationQuerySchema extends Named<
  typeof datasetRestPaginationQuerySchemaDefinition
> {}
export const datasetRestPaginationQuerySchema: DatasetRestPaginationQuerySchema =
  datasetRestPaginationQuerySchemaDefinition;

const datasetRestBatchCreateRecordsSchemaDefinition = z.object({
  entries: z
    .array(z.record(z.string(), z.any()))
    .min(1, "entries is required")
    .max(DATASET_BATCH_MAX, `Maximum batch size is ${DATASET_BATCH_MAX} entries`),
});
export interface DatasetRestBatchCreateRecordsSchema extends Named<
  typeof datasetRestBatchCreateRecordsSchemaDefinition
> {}
export const datasetRestBatchCreateRecordsSchema: DatasetRestBatchCreateRecordsSchema =
  datasetRestBatchCreateRecordsSchemaDefinition;

const datasetRestDeleteRecordsSchemaDefinition = z.object({
  recordIds: z
    .array(z.string())
    .min(1, "recordIds is required")
    .max(DATASET_BATCH_MAX, `Maximum ${DATASET_BATCH_MAX} records per batch delete`),
});
export interface DatasetRestDeleteRecordsSchema extends Named<
  typeof datasetRestDeleteRecordsSchemaDefinition
> {}
export const datasetRestDeleteRecordsSchema: DatasetRestDeleteRecordsSchema =
  datasetRestDeleteRecordsSchemaDefinition;

/** The legacy spelling of the batch-records body; same grain, older name. */
const datasetRestLegacyEntriesSchemaDefinition = z
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
export interface DatasetRestLegacyEntriesSchema extends Named<
  typeof datasetRestLegacyEntriesSchemaDefinition
> {}
export const datasetRestLegacyEntriesSchema: DatasetRestLegacyEntriesSchema =
  datasetRestLegacyEntriesSchemaDefinition;

const datasetRestSlugOrIdParamsSchemaDefinition = z.object({ slugOrId: z.string() });
export interface DatasetRestSlugOrIdParamsSchema extends Named<
  typeof datasetRestSlugOrIdParamsSchemaDefinition
> {}
export const datasetRestSlugOrIdParamsSchema: DatasetRestSlugOrIdParamsSchema =
  datasetRestSlugOrIdParamsSchemaDefinition;
const datasetRestSlugParamsSchemaDefinition = z.object({ datasetSlug: z.string() });
export interface DatasetRestSlugParamsSchema extends Named<
  typeof datasetRestSlugParamsSchemaDefinition
> {}
export const datasetRestSlugParamsSchema: DatasetRestSlugParamsSchema =
  datasetRestSlugParamsSchemaDefinition;

/** `PATCH /api/dataset/:slugOrId/records/:recordId`: one record in one dataset. */
const datasetRestRecordParamsSchemaDefinition = z.object({
  slugOrId: z.string(),
  recordId: z.string(),
});
export interface DatasetRestRecordParamsSchema extends Named<
  typeof datasetRestRecordParamsSchemaDefinition
> {}
export const datasetRestRecordParamsSchema: DatasetRestRecordParamsSchema =
  datasetRestRecordParamsSchemaDefinition;

/** `PATCH /api/dataset/:slugOrId/records/:recordId`: the entry the record holds now. */
const datasetRestUpdateRecordSchemaDefinition = z.object({
  entry: z.record(z.string(), z.any()),
});
export interface DatasetRestUpdateRecordSchema extends Named<
  typeof datasetRestUpdateRecordSchemaDefinition
> {}
export const datasetRestUpdateRecordSchema: DatasetRestUpdateRecordSchema =
  datasetRestUpdateRecordSchemaDefinition;

/** `POST /api/dataset/imports`: the dataset to build, and the confirmed file it reads. */
const datasetRestImportSchemaDefinition = createDatasetFromStoredObjectInputSchema
  .omit({ projectId: true })
  .meta({ id: "DatasetImport" });
export interface DatasetRestImportSchema extends Named<typeof datasetRestImportSchemaDefinition> {}
export const datasetRestImportSchema: DatasetRestImportSchema = datasetRestImportSchemaDefinition;

/** `POST /api/dataset/:slugOrId/imports`: the confirmed file whose rows are appended. */
const datasetRestAppendImportSchemaDefinition = appendStoredObjectToDatasetInputSchema
  .pick({ storedObjectId: true })
  .meta({ id: "DatasetAppendImport" });
export interface DatasetRestAppendImportSchema extends Named<
  typeof datasetRestAppendImportSchemaDefinition
> {}
export const datasetRestAppendImportSchema: DatasetRestAppendImportSchema =
  datasetRestAppendImportSchemaDefinition;

/** The deprecated multipart `/upload` routes' text field; the file is the `file` part. */
const datasetRestUploadFieldsSchemaDefinition = z.object({ name: z.string().trim().min(1) });
export interface DatasetRestUploadFieldsSchema extends Named<
  typeof datasetRestUploadFieldsSchemaDefinition
> {}
export const datasetRestUploadFieldsSchema: DatasetRestUploadFieldsSchema =
  datasetRestUploadFieldsSchemaDefinition;
const datasetRestNoUploadFieldsSchemaDefinition = z.object({});
export interface DatasetRestNoUploadFieldsSchema extends Named<
  typeof datasetRestNoUploadFieldsSchemaDefinition
> {}
export const datasetRestNoUploadFieldsSchema: DatasetRestNoUploadFieldsSchema =
  datasetRestNoUploadFieldsSchemaDefinition;

/** The deprecated multipart `/attachments` text field: the owning dataset, absent for a draft. */
/** `POST /api/dataset/attachments`: the project the file is stored for, as on main. */
const datasetRestAttachmentQuerySchemaDefinition = z.object({
  projectId: z.string().min(1).describe("The project the file is stored for."),
});
export interface DatasetRestAttachmentQuerySchema extends Named<
  typeof datasetRestAttachmentQuerySchemaDefinition
> {}
export const datasetRestAttachmentQuerySchema: DatasetRestAttachmentQuerySchema =
  datasetRestAttachmentQuerySchemaDefinition;

const datasetRestAttachmentFieldsSchemaDefinition = z.object({
  datasetId: z
    .string()
    .optional()
    .describe("The dataset that owns the file. Omit it while the dataset is still a draft."),
});
export interface DatasetRestAttachmentFieldsSchema extends Named<
  typeof datasetRestAttachmentFieldsSchemaDefinition
> {}
export const datasetRestAttachmentFieldsSchema: DatasetRestAttachmentFieldsSchema =
  datasetRestAttachmentFieldsSchemaDefinition;

/** `POST /api/dataset/attachments/uploads`: the file about to be sent to its signed upload. */
const datasetRestAttachmentUploadSchemaDefinition = z.object({
  filename: storedObjectFilenameSchema.describe("The file name the reference will carry."),
  mediaType: storedObjectMediaTypeSchema.describe("The media type of the file."),
  byteLength: storedObjectByteLengthSchema.describe("The size of the file, in bytes."),
});
export interface DatasetRestAttachmentUploadSchema extends Named<
  typeof datasetRestAttachmentUploadSchemaDefinition
> {}
export const datasetRestAttachmentUploadSchema: DatasetRestAttachmentUploadSchema =
  datasetRestAttachmentUploadSchemaDefinition;

/** `POST /api/dataset/upload`: the dataset the posted file became. */
const datasetRestUploadCreatedSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  columnTypes: datasetColumnsSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  recordsCreated: z.number().int().nonnegative(),
});
export interface DatasetRestUploadCreatedSchema extends Named<
  typeof datasetRestUploadCreatedSchemaDefinition
> {}
export const datasetRestUploadCreatedSchema: DatasetRestUploadCreatedSchema =
  datasetRestUploadCreatedSchemaDefinition;

/** The dataset as this family answers it: the stored row plus its platform URL. */
const datasetRestSummarySchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  columnTypes: datasetColumnsSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  platformUrl: z.string(),
});
export interface DatasetRestSummarySchema extends Named<
  typeof datasetRestSummarySchemaDefinition
> {}
export const datasetRestSummarySchema: DatasetRestSummarySchema =
  datasetRestSummarySchemaDefinition;

/** `GET /api/dataset`: a page of the project's datasets, each with its URL. */
const datasetRestListResponseSchemaDefinition = z.object({
  data: z.array(
    datasetRestSummarySchema.safeExtend({ recordCount: z.number().int().nonnegative() }),
  ),
  pagination: datasetPaginationSchema,
});
export interface DatasetRestListResponseSchema extends Named<
  typeof datasetRestListResponseSchemaDefinition
> {}
export const datasetRestListResponseSchema: DatasetRestListResponseSchema =
  datasetRestListResponseSchemaDefinition;

/** `GET /api/dataset/:slugOrId`: the dataset, with every entry inline. */
const datasetRestDetailResponseSchemaDefinition = z.object({
  ...datasetRestSummarySchema.shape,
  data: z.array(datasetRecordSchema),
});
export interface DatasetRestDetailResponseSchema extends Named<
  typeof datasetRestDetailResponseSchemaDefinition
> {}
export const datasetRestDetailResponseSchema: DatasetRestDetailResponseSchema =
  datasetRestDetailResponseSchemaDefinition;

/** `POST /api/dataset/:slugOrId/records`: the entries that were appended. */
const datasetRestRecordsCreatedSchemaDefinition = z.object({
  data: z.array(datasetRecordSchema),
});
export interface DatasetRestRecordsCreatedSchema extends Named<
  typeof datasetRestRecordsCreatedSchemaDefinition
> {}
export const datasetRestRecordsCreatedSchema: DatasetRestRecordsCreatedSchema =
  datasetRestRecordsCreatedSchemaDefinition;

/** `POST /api/dataset/:slug/entries`: the legacy family's own acknowledgement. */
const datasetRestEntriesAddedSchemaDefinition = z.object({ success: z.literal(true) });
export interface DatasetRestEntriesAddedSchema extends Named<
  typeof datasetRestEntriesAddedSchemaDefinition
> {}
export const datasetRestEntriesAddedSchema: DatasetRestEntriesAddedSchema =
  datasetRestEntriesAddedSchemaDefinition;

/** `GET /api/dataset/:slugOrId/records`: one page of a dataset's entries. */
const datasetRestRecordPageSchemaDefinition = z.object({
  data: z.array(datasetRecordSchema),
  pagination: datasetPaginationSchema,
  /** The dataset the page belongs to, as the single GET answers it without its rows. */
  dataset: datasetRestSummarySchema.optional(),
});
export interface DatasetRestRecordPageSchema extends Named<
  typeof datasetRestRecordPageSchemaDefinition
> {}
export const datasetRestRecordPageSchema: DatasetRestRecordPageSchema =
  datasetRestRecordPageSchemaDefinition;

/** `DELETE /api/dataset/:slugOrId`: the dataset that was archived. */
const datasetRestArchivedSchemaDefinition = z.object({
  id: z.string(),
  archived: z.literal(true),
});
export interface DatasetRestArchivedSchema extends Named<
  typeof datasetRestArchivedSchemaDefinition
> {}
export const datasetRestArchivedSchema: DatasetRestArchivedSchema =
  datasetRestArchivedSchemaDefinition;

/** `DELETE /api/dataset/:slugOrId/records`: how many entries were removed. */
const datasetRestRecordsDeletedSchemaDefinition = z.object({
  deletedCount: z.number().int().nonnegative(),
});
export interface DatasetRestRecordsDeletedSchema extends Named<
  typeof datasetRestRecordsDeletedSchemaDefinition
> {}
export const datasetRestRecordsDeletedSchema: DatasetRestRecordsDeletedSchema =
  datasetRestRecordsDeletedSchemaDefinition;
