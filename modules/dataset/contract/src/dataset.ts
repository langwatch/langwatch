import type { Named } from "@langwatch/module";
import { resolveRequestBound } from "@langwatch/plans";
import {
  storedObjectByteLengthSchema,
  storedObjectFilenameSchema,
  storedObjectIdSchema,
  storedObjectMediaTypeSchema,
} from "@langwatch/stored-object-contract";
import { z } from "zod";

export const datasetColumnTypeSchema = z.enum([
  "string",
  "boolean",
  "number",
  "date",
  "list",
  "json",
  "spans",
  "rag_contexts",
  "chat_messages",
  "annotations",
  "evaluations",
  "image",
  "file",
]);
export type DatasetColumnType = z.infer<typeof datasetColumnTypeSchema>;

/** Strips extra keys, as main does: an upload stores `sourceHeader` on its columns (WEB-5120). */
const datasetColumnSchemaDefinition = z.object({
  name: z.string().min(1),
  type: datasetColumnTypeSchema,
});
export interface DatasetColumnSchema extends Named<typeof datasetColumnSchemaDefinition> {}
export const datasetColumnSchema: DatasetColumnSchema = datasetColumnSchemaDefinition;
const datasetColumnsSchemaDefinition = z.array(datasetColumnSchema);
export interface DatasetColumnsSchema extends Named<typeof datasetColumnsSchemaDefinition> {}
export const datasetColumnsSchema: DatasetColumnsSchema = datasetColumnsSchemaDefinition;
export type DatasetColumn = z.infer<typeof datasetColumnSchema>;
export type DatasetColumns = z.infer<typeof datasetColumnsSchema>;

export const datasetJsonSchema: z.ZodType<
  string | number | boolean | null | { [key: string]: unknown } | unknown[]
> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(datasetJsonSchema),
    z.record(z.string(), z.unknown()),
  ]),
);

const datasetRecordEntrySchemaDefinition = z
  .record(z.string(), z.unknown())
  .and(z.object({ id: z.string().min(1) }));
export interface DatasetRecordEntrySchema extends Named<
  typeof datasetRecordEntrySchemaDefinition
> {}
export const datasetRecordEntrySchema: DatasetRecordEntrySchema =
  datasetRecordEntrySchemaDefinition;
export type DatasetRecordEntry = z.infer<typeof datasetRecordEntrySchema>;

/** A dataset held in the browser before (or instead of) being saved: its rows and its columns. */
export type InMemoryDataset = {
  datasetId?: string;
  name?: string;
  datasetRecords: DatasetRecordEntry[];
  columnTypes: DatasetColumns;
};

const datasetRecordInputSchemaDefinition = z
  .record(z.string(), z.unknown())
  .and(z.object({ id: z.string().min(1).optional() }));
export interface DatasetRecordInputSchema extends Named<
  typeof datasetRecordInputSchemaDefinition
> {}
export const datasetRecordInputSchema: DatasetRecordInputSchema =
  datasetRecordInputSchemaDefinition;
export type DatasetRecordInput = z.infer<typeof datasetRecordInputSchema>;

const datasetRecordFormSchemaDefinition = z.object({
  name: z.string().min(1),
  columnTypes: datasetColumnsSchema,
});
export interface DatasetRecordFormSchema extends Named<typeof datasetRecordFormSchemaDefinition> {}
export const datasetRecordFormSchema: DatasetRecordFormSchema = datasetRecordFormSchemaDefinition;
export type DatasetRecordForm = z.infer<typeof datasetRecordFormSchema>;

/** Portable span-shaped dataset value used by trace mapping on both sides. */
const datasetSpanSchemaDefinition = z.record(z.string(), z.unknown());
export interface DatasetSpanSchema extends Named<typeof datasetSpanSchemaDefinition> {}
export const datasetSpanSchema: DatasetSpanSchema = datasetSpanSchemaDefinition;

/**
 * The outer validation shell is the registry's enterprise ceiling; the
 * application refuses batches above the caller's tier value through the
 * entitlement peer.
 */
const DATASET_BATCH_MAX = resolveRequestBound("datasetBatchMax", "ENTERPRISE");

const newDatasetEntriesSchemaDefinition = z.object({
  entries: z.array(datasetRecordEntrySchema).max(DATASET_BATCH_MAX),
});
export interface NewDatasetEntriesSchema extends Named<typeof newDatasetEntriesSchemaDefinition> {}
export const newDatasetEntriesSchema: NewDatasetEntriesSchema = newDatasetEntriesSchemaDefinition;

const datasetConfirmColumnsSchemaDefinition = z.array(
  z.object({
    name: z.string(),
    type: datasetColumnTypeSchema,
    sourceHeader: z.string(),
  }),
);
export interface DatasetConfirmColumnsSchema extends Named<
  typeof datasetConfirmColumnsSchemaDefinition
> {}
export const datasetConfirmColumnsSchema: DatasetConfirmColumnsSchema =
  datasetConfirmColumnsSchemaDefinition;
export type DatasetConfirmColumns = z.infer<typeof datasetConfirmColumnsSchema>;

export const datasetStatusSchema = z.enum(["uploading", "processing", "ready", "failed"]);
export type DatasetStatus = z.infer<typeof datasetStatusSchema>;

/** A dataset's normalisation came to rest, ready or failed; reads of the dataset refresh on it. */
export const DATASET_NORMALIZATION_SETTLED_EVENT_TYPE = "lw.dataset.normalization_settled" as const;
export const DATASET_NORMALIZATION_EVENT_VERSION = "2026-10-10" as const;

const datasetNormalizationSettledEventDataSchemaDefinition = z.object({
  projectId: z.string().min(1),
  datasetId: z.string().min(1),
  status: datasetStatusSchema.extract(["ready", "failed"]),
});
export interface DatasetNormalizationSettledEventDataSchema extends Named<
  typeof datasetNormalizationSettledEventDataSchemaDefinition
> {}
export const datasetNormalizationSettledEventDataSchema: DatasetNormalizationSettledEventDataSchema =
  datasetNormalizationSettledEventDataSchemaDefinition;
export type DatasetNormalizationSettledEventData = z.infer<
  typeof datasetNormalizationSettledEventDataSchema
>;

export const datasetContentLayoutSchema = z.enum(["postgres", "s3_jsonl"]);
export type DatasetContentLayout = z.infer<typeof datasetContentLayoutSchema>;

export type DatasetEntrySelection = "first" | "last" | "random" | "all" | number;

const datasetSchemaDefinition = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
    columnTypes: datasetColumnsSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
    archivedAt: z.date().nullable(),
    mapping: z.unknown().nullable(),
    useS3: z.boolean(),
    s3RecordCount: z.number().int().nullable(),
    contentLayout: datasetContentLayoutSchema,
    status: datasetStatusSchema,
    statusError: z.string().nullable(),
    stagingKey: z.string().nullable(),
    uploadFilename: z.string().nullable(),
    rowCount: z.number().int().nullable(),
    sizeBytes: z.bigint().nullable(),
    chunkCount: z.number().int().nullable(),
    chunkOffsets: z.unknown().nullable(),
  })
  .strict();
export interface DatasetSchema extends Named<typeof datasetSchemaDefinition> {}
export const datasetSchema: DatasetSchema = datasetSchemaDefinition;
export type Dataset = z.infer<typeof datasetSchema>;

/** Where one dataset's content lives, as a storage migration's inventory reads it. */
const datasetStorageEntrySchemaDefinition = datasetSchema.pick({
  id: true,
  projectId: true,
  contentLayout: true,
  status: true,
  chunkCount: true,
});
export interface DatasetStorageEntrySchema extends Named<
  typeof datasetStorageEntrySchemaDefinition
> {}
export const datasetStorageEntrySchema: DatasetStorageEntrySchema =
  datasetStorageEntrySchemaDefinition;
export type DatasetStorageEntry = z.infer<typeof datasetStorageEntrySchema>;

/** One id-ordered page of a project's datasets, after the `afterId` cursor. */
export type DatasetStoragePageInput = { projectId: string; afterId?: string; limit: number };

/**
 * A dataset as the browser reads it. The stored size is a bigint, which JSON
 * cannot carry, so it crosses as a number: no dataset comes near 2^53 bytes.
 */
const datasetWireSchemaDefinition = z.strictObject({
  ...datasetSchema.shape,
  sizeBytes: z
    .bigint()
    .nullable()
    .transform((size) => (size === null ? null : Number(size))),
});
export interface DatasetWireSchema extends Named<typeof datasetWireSchemaDefinition> {}
export const datasetWireSchema: DatasetWireSchema = datasetWireSchemaDefinition;
export type DatasetWire = z.infer<typeof datasetWireSchema>;

const datasetRecordSchemaDefinition = z
  .object({
    id: z.string().min(1),
    datasetId: z.string().min(1),
    projectId: z.string().min(1),
    entry: z.record(z.string(), z.unknown()),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export interface DatasetRecordSchema extends Named<typeof datasetRecordSchemaDefinition> {}
export const datasetRecordSchema: DatasetRecordSchema = datasetRecordSchemaDefinition;
export type DatasetRecord = z.infer<typeof datasetRecordSchema>;

const datasetSummarySchemaDefinition = datasetSchema.safeExtend({
  recordCount: z.number().int().nonnegative(),
});
export interface DatasetSummarySchema extends Named<typeof datasetSummarySchemaDefinition> {}
export const datasetSummarySchema: DatasetSummarySchema = datasetSummarySchemaDefinition;
export type DatasetSummary = z.infer<typeof datasetSummarySchema>;

/** One row of the dataset list as the browser reads it. */
const datasetSummaryWireSchemaDefinition = datasetWireSchema.safeExtend({
  recordCount: z.number().int().nonnegative(),
});
export interface DatasetSummaryWireSchema extends Named<
  typeof datasetSummaryWireSchemaDefinition
> {}
export const datasetSummaryWireSchema: DatasetSummaryWireSchema =
  datasetSummaryWireSchemaDefinition;
export type DatasetSummaryWire = z.infer<typeof datasetSummaryWireSchema>;

const datasetPaginationSchemaDefinition = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export interface DatasetPaginationSchema extends Named<typeof datasetPaginationSchemaDefinition> {}
export const datasetPaginationSchema: DatasetPaginationSchema = datasetPaginationSchemaDefinition;
export type DatasetPagination = z.infer<typeof datasetPaginationSchema>;

const datasetListResultSchemaDefinition = z.object({
  data: z.array(datasetSummarySchema),
  pagination: datasetPaginationSchema,
});
export interface DatasetListResultSchema extends Named<typeof datasetListResultSchemaDefinition> {}
export const datasetListResultSchema: DatasetListResultSchema = datasetListResultSchemaDefinition;
export type DatasetListResult = z.infer<typeof datasetListResultSchema>;

const datasetRecordPageSchemaDefinition = z.object({
  data: z.array(datasetRecordSchema),
  pagination: datasetPaginationSchema,
  /** The dataset the page belongs to, so a paging reader needs no second call for it. */
  dataset: datasetSchema.optional(),
});
export interface DatasetRecordPageSchema extends Named<typeof datasetRecordPageSchemaDefinition> {}
export const datasetRecordPageSchema: DatasetRecordPageSchema = datasetRecordPageSchemaDefinition;
export type DatasetRecordPage = z.infer<typeof datasetRecordPageSchema>;

const datasetPageSchemaDefinition = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  columnTypes: datasetColumnsSchema,
  datasetRecords: z.array(datasetRecordSchema),
  count: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export interface DatasetPageSchema extends Named<typeof datasetPageSchemaDefinition> {}
export const datasetPageSchema: DatasetPageSchema = datasetPageSchemaDefinition;
export type DatasetPage = z.infer<typeof datasetPageSchema>;

const datasetWithRecordsSchemaDefinition = z.object({
  dataset: datasetSchema,
  records: z.array(datasetRecordSchema),
  /** True whenever a row the read asked for was left out of `records`. */
  truncated: z.boolean(),
  /** How many rows the read asked for, before the byte budget cut it short. */
  totalRows: z.number().int().nonnegative().optional(),
});
export interface DatasetWithRecordsSchema extends Named<
  typeof datasetWithRecordsSchemaDefinition
> {}
export const datasetWithRecordsSchema: DatasetWithRecordsSchema =
  datasetWithRecordsSchemaDefinition;
export type DatasetWithRecords = z.infer<typeof datasetWithRecordsSchema>;

const datasetHeadSchemaDefinition = z.object({
  dataset: datasetSchema,
  records: z.array(datasetRecordSchema),
  total: z.number().int().nonnegative(),
});
export interface DatasetHeadSchema extends Named<typeof datasetHeadSchemaDefinition> {}
export const datasetHeadSchema: DatasetHeadSchema = datasetHeadSchemaDefinition;
export type DatasetHead = z.infer<typeof datasetHeadSchema>;

const datasetRecordMutationResultSchemaDefinition = z.object({
  record: datasetRecordSchema,
  created: z.boolean(),
});
export interface DatasetRecordMutationResultSchema extends Named<
  typeof datasetRecordMutationResultSchemaDefinition
> {}
export const datasetRecordMutationResultSchema: DatasetRecordMutationResultSchema =
  datasetRecordMutationResultSchemaDefinition;
export type DatasetRecordMutationResult = z.infer<typeof datasetRecordMutationResultSchema>;

const upsertDatasetInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    name: z.string().min(1),
    columnTypes: datasetColumnsSchema,
    datasetId: z.string().min(1).optional(),
    datasetRecords: z.array(datasetRecordInputSchema).optional(),
  })
  .strict();
export interface UpsertDatasetInputSchema extends Named<
  typeof upsertDatasetInputSchemaDefinition
> {}
export const upsertDatasetInputSchema: UpsertDatasetInputSchema =
  upsertDatasetInputSchemaDefinition;
export type UpsertDatasetInput = z.infer<typeof upsertDatasetInputSchema>;

const datasetNameInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    proposedName: z.string().min(1),
    excludeDatasetId: z.string().min(1).optional(),
  })
  .strict();
export interface DatasetNameInputSchema extends Named<typeof datasetNameInputSchemaDefinition> {}
export const datasetNameInputSchema: DatasetNameInputSchema = datasetNameInputSchemaDefinition;
export type DatasetNameInput = z.infer<typeof datasetNameInputSchema>;

const datasetNameResultSchemaDefinition = z.object({
  available: z.boolean(),
  slug: z.string().min(1),
  conflictsWith: z.string().min(1).optional(),
});
export interface DatasetNameResultSchema extends Named<typeof datasetNameResultSchemaDefinition> {}
export const datasetNameResultSchema: DatasetNameResultSchema = datasetNameResultSchemaDefinition;
export type DatasetNameResult = z.infer<typeof datasetNameResultSchema>;

const datasetLookupInputSchemaDefinition = z
  .object({ slugOrId: z.string().min(1), projectId: z.string().min(1) })
  .strict();
export interface DatasetLookupInputSchema extends Named<
  typeof datasetLookupInputSchemaDefinition
> {}
export const datasetLookupInputSchema: DatasetLookupInputSchema =
  datasetLookupInputSchemaDefinition;
export type DatasetLookupInput = z.infer<typeof datasetLookupInputSchema>;

const datasetWithRecordsInputSchemaDefinition = datasetLookupInputSchema.safeExtend({
  /**
   * The byte budget in megabytes. Absent, the read is held to what the
   * organization answers inline in one response; `null` reads every row.
   */
  limitMb: z.number().nonnegative().nullable().optional(),
  entrySelection: z
    .union([
      z.literal("first"),
      z.literal("last"),
      z.literal("random"),
      z.literal("all"),
      z.number().int().nonnegative(),
    ])
    .default("all"),
});
export interface DatasetWithRecordsInputSchema extends Named<
  typeof datasetWithRecordsInputSchemaDefinition
> {}
export const datasetWithRecordsInputSchema: DatasetWithRecordsInputSchema =
  datasetWithRecordsInputSchemaDefinition;
export type DatasetWithRecordsInput = z.input<typeof datasetWithRecordsInputSchema>;

/** The largest page the public dataset REST family accepts; the service must accept it too. */
export const DATASET_PAGE_LIMIT_MAX = 1000;

const listDatasetsInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().max(DATASET_PAGE_LIMIT_MAX).default(50),
  })
  .strict();
export interface ListDatasetsInputSchema extends Named<typeof listDatasetsInputSchemaDefinition> {}
export const listDatasetsInputSchema: ListDatasetsInputSchema = listDatasetsInputSchemaDefinition;
export type ListDatasetsInput = z.input<typeof listDatasetsInputSchema>;

const datasetRecordLookupInputSchemaDefinition = z
  .object({
    slugOrId: z.string().min(1),
    projectId: z.string().min(1),
  })
  .strict();
export interface DatasetRecordLookupInputSchema extends Named<
  typeof datasetRecordLookupInputSchemaDefinition
> {}
export const datasetRecordLookupInputSchema: DatasetRecordLookupInputSchema =
  datasetRecordLookupInputSchemaDefinition;

const datasetPageInputSchemaDefinition = datasetRecordLookupInputSchema.safeExtend({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(DATASET_PAGE_LIMIT_MAX).default(50),
  search: z.string().optional(),
});
export interface DatasetPageInputSchema extends Named<typeof datasetPageInputSchemaDefinition> {}
export const datasetPageInputSchema: DatasetPageInputSchema = datasetPageInputSchemaDefinition;
export type DatasetPageInput = z.input<typeof datasetPageInputSchema>;

const createDatasetRecordsInputSchemaDefinition = datasetRecordLookupInputSchema.safeExtend({
  entries: z.array(datasetRecordInputSchema),
});
export interface CreateDatasetRecordsInputSchema extends Named<
  typeof createDatasetRecordsInputSchemaDefinition
> {}
export const createDatasetRecordsInputSchema: CreateDatasetRecordsInputSchema =
  createDatasetRecordsInputSchemaDefinition;
export type CreateDatasetRecordsInput = z.infer<typeof createDatasetRecordsInputSchema>;

const updateDatasetRecordInputSchemaDefinition = datasetRecordLookupInputSchema.safeExtend({
  recordId: z.string().min(1),
  updatedRecord: z.record(z.string(), z.unknown()),
});
export interface UpdateDatasetRecordInputSchema extends Named<
  typeof updateDatasetRecordInputSchemaDefinition
> {}
export const updateDatasetRecordInputSchema: UpdateDatasetRecordInputSchema =
  updateDatasetRecordInputSchemaDefinition;
export type UpdateDatasetRecordInput = z.infer<typeof updateDatasetRecordInputSchema>;

const deleteDatasetRecordsInputSchemaDefinition = datasetRecordLookupInputSchema.safeExtend({
  recordIds: z.array(z.string().min(1)),
});
export interface DeleteDatasetRecordsInputSchema extends Named<
  typeof deleteDatasetRecordsInputSchemaDefinition
> {}
export const deleteDatasetRecordsInputSchema: DeleteDatasetRecordsInputSchema =
  deleteDatasetRecordsInputSchemaDefinition;
export type DeleteDatasetRecordsInput = z.infer<typeof deleteDatasetRecordsInputSchema>;

/** A posted file's body, read once as it arrives. */
const uploadedBytesSchema = z.custom<AsyncIterable<Uint8Array>>(
  (value) => typeof value === "object" && value !== null && Symbol.asyncIterator in value,
);

const uploadExistingDatasetInputSchemaDefinition = z.object({
  slugOrId: z.string().min(1),
  projectId: z.string().min(1),
  filename: z.string().min(1),
  bytes: uploadedBytesSchema,
  fileSize: z.number().nonnegative(),
});
export interface UploadExistingDatasetInputSchema extends Named<
  typeof uploadExistingDatasetInputSchemaDefinition
> {}
export const uploadExistingDatasetInputSchema: UploadExistingDatasetInputSchema =
  uploadExistingDatasetInputSchemaDefinition;
export type UploadExistingDatasetInput = z.infer<typeof uploadExistingDatasetInputSchema>;

const createDatasetFromUploadInputSchemaDefinition = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  filename: z.string().min(1),
  bytes: uploadedBytesSchema,
  fileSize: z.number().nonnegative(),
});
export interface CreateDatasetFromUploadInputSchema extends Named<
  typeof createDatasetFromUploadInputSchemaDefinition
> {}
export const createDatasetFromUploadInputSchema: CreateDatasetFromUploadInputSchema =
  createDatasetFromUploadInputSchemaDefinition;
export type CreateDatasetFromUploadInput = z.infer<typeof createDatasetFromUploadInputSchema>;

/** Deprecated with `POST /api/dataset/attachments`; retires in the next release (ADR-158 §8). */
const storeDatasetAttachmentUploadInputSchemaDefinition = z.object({
  projectId: z.string().min(1),
  datasetId: z.string().optional(),
  filename: z.string(),
  mediaType: z.string().optional(),
  bytes: uploadedBytesSchema,
  fileSize: z.number().nonnegative(),
});
export interface StoreDatasetAttachmentUploadInputSchema extends Named<
  typeof storeDatasetAttachmentUploadInputSchemaDefinition
> {}
export const storeDatasetAttachmentUploadInputSchema: StoreDatasetAttachmentUploadInputSchema =
  storeDatasetAttachmentUploadInputSchemaDefinition;
export type StoreDatasetAttachmentUploadInput = z.infer<
  typeof storeDatasetAttachmentUploadInputSchema
>;

/** A posted file stored as a dataset attachment: the reference a cell holds, and its metadata. */
const storedDatasetAttachmentSchemaDefinition = z
  .object({
    url: z
      .string()
      .describe("The value to write into the cell, and the address the file is served from."),
    name: z.string().describe("The file name the reference carries."),
    mediaType: z.string().describe("The media type the file is stored under."),
    sizeBytes: z.number().describe("The size of the stored file, in bytes."),
  })
  .meta({ id: "DatasetAttachment" });
export interface StoredDatasetAttachmentSchema extends Named<
  typeof storedDatasetAttachmentSchemaDefinition
> {}
export const storedDatasetAttachmentSchema: StoredDatasetAttachmentSchema =
  storedDatasetAttachmentSchemaDefinition;
export type StoredDatasetAttachment = z.infer<typeof storedDatasetAttachmentSchema>;

/** A file about to be uploaded into an image or file cell. */
const createDatasetAttachmentUploadInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    filename: storedObjectFilenameSchema,
    mediaType: storedObjectMediaTypeSchema,
    byteLength: storedObjectByteLengthSchema,
  })
  .strict();
export interface CreateDatasetAttachmentUploadInputSchema extends Named<
  typeof createDatasetAttachmentUploadInputSchemaDefinition
> {}
export const createDatasetAttachmentUploadInputSchema: CreateDatasetAttachmentUploadInputSchema =
  createDatasetAttachmentUploadInputSchemaDefinition;
export type CreateDatasetAttachmentUploadInput = z.infer<
  typeof createDatasetAttachmentUploadInputSchema
>;

/** Where a cell's file is sent: one signed address, good until `expiresAt`. */
const datasetAttachmentUploadSchemaDefinition = z
  .object({
    objectId: z.string().min(1),
    uploadUrl: z.string().url(),
    method: z.literal("PUT"),
    headers: z.record(z.string(), z.string().min(1)).optional(),
    expiresAt: z.string().min(1),
  })
  .strict();
export interface DatasetAttachmentUploadSchema extends Named<
  typeof datasetAttachmentUploadSchemaDefinition
> {}
export const datasetAttachmentUploadSchema: DatasetAttachmentUploadSchema =
  datasetAttachmentUploadSchemaDefinition;
export type DatasetAttachmentUpload = z.infer<typeof datasetAttachmentUploadSchema>;

export type CreateDatasetFromUploadResult = Pick<Dataset, "createdAt" | "updatedAt"> & {
  id: string;
  name: string;
  slug: string;
  columnTypes: DatasetColumns;
  recordsCreated: number;
};

/** A dataset built in the background from a confirmed `dataset_import` file (ADR-158 §6). */
const createDatasetFromStoredObjectInputSchemaDefinition = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  storedObjectId: storedObjectIdSchema,
  columnTypes: datasetConfirmColumnsSchema.optional(),
});
export interface CreateDatasetFromStoredObjectInputSchema extends Named<
  typeof createDatasetFromStoredObjectInputSchemaDefinition
> {}
export const createDatasetFromStoredObjectInputSchema: CreateDatasetFromStoredObjectInputSchema =
  createDatasetFromStoredObjectInputSchemaDefinition;
export type CreateDatasetFromStoredObjectInput = z.infer<
  typeof createDatasetFromStoredObjectInputSchema
>;

const datasetImportStartedSchemaDefinition = z.object({
  datasetId: z.string(),
  slug: z.string(),
  status: z.literal("processing"),
});
export interface DatasetImportStartedSchema extends Named<
  typeof datasetImportStartedSchemaDefinition
> {}
export const datasetImportStartedSchema: DatasetImportStartedSchema =
  datasetImportStartedSchemaDefinition;
export type DatasetImportStarted = z.infer<typeof datasetImportStartedSchema>;

/** A confirmed `dataset_import` file's rows appended to an existing dataset. */
const appendStoredObjectToDatasetInputSchemaDefinition = z.object({
  projectId: z.string().min(1),
  slugOrId: z.string().min(1),
  storedObjectId: storedObjectIdSchema,
});
export interface AppendStoredObjectToDatasetInputSchema extends Named<
  typeof appendStoredObjectToDatasetInputSchemaDefinition
> {}
export const appendStoredObjectToDatasetInputSchema: AppendStoredObjectToDatasetInputSchema =
  appendStoredObjectToDatasetInputSchemaDefinition;
export type AppendStoredObjectToDatasetInput = z.infer<
  typeof appendStoredObjectToDatasetInputSchema
>;

const datasetImportAppendedSchemaDefinition = z.object({
  datasetId: z.string(),
  recordsCreated: z.number().int().nonnegative(),
});
export interface DatasetImportAppendedSchema extends Named<
  typeof datasetImportAppendedSchemaDefinition
> {}
export const datasetImportAppendedSchema: DatasetImportAppendedSchema =
  datasetImportAppendedSchemaDefinition;
export type DatasetImportAppended = z.infer<typeof datasetImportAppendedSchema>;

const uploadProcessingSchemaDefinition = z.object({
  datasetId: z.string(),
  status: z.literal("processing"),
});
export interface UploadProcessingSchema extends Named<typeof uploadProcessingSchemaDefinition> {}
export const uploadProcessingSchema: UploadProcessingSchema = uploadProcessingSchemaDefinition;
export type UploadProcessing = z.infer<typeof uploadProcessingSchema>;

/** A dataset whose preparation failed or stalled, prepared again from the same stored file. */
const retryNormalizeInputSchemaDefinition = z.object({
  projectId: z.string().min(1),
  datasetId: z.string().min(1),
});
export interface RetryNormalizeInputSchema extends Named<
  typeof retryNormalizeInputSchemaDefinition
> {}
export const retryNormalizeInputSchema: RetryNormalizeInputSchema =
  retryNormalizeInputSchemaDefinition;
export type RetryNormalizeInput = z.infer<typeof retryNormalizeInputSchema>;

const copyDatasetInputSchemaDefinition = z
  .object({
    sourceDatasetId: z.string().min(1),
    sourceProjectId: z.string().min(1),
    targetProjectId: z.string().min(1),
  })
  .strict();
export interface CopyDatasetInputSchema extends Named<typeof copyDatasetInputSchemaDefinition> {}
export const copyDatasetInputSchema: CopyDatasetInputSchema = copyDatasetInputSchemaDefinition;
export type CopyDatasetInput = z.infer<typeof copyDatasetInputSchema>;
