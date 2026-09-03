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
]);
export type DatasetColumnType = z.infer<typeof datasetColumnTypeSchema>;

export const datasetColumnSchema = z
  .object({ name: z.string().min(1), type: datasetColumnTypeSchema })
  .strict();
export const datasetColumnsSchema = z.array(datasetColumnSchema);
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

export const datasetRecordEntrySchema = z
  .record(z.string(), z.unknown())
  .and(z.object({ id: z.string().min(1) }));
export type DatasetRecordEntry = z.infer<typeof datasetRecordEntrySchema>;

export const datasetRecordInputSchema = z
  .record(z.string(), z.unknown())
  .and(z.object({ id: z.string().min(1).optional() }));
export type DatasetRecordInput = z.infer<typeof datasetRecordInputSchema>;

export const datasetRecordFormSchema = z.object({
  name: z.string().min(1),
  columnTypes: datasetColumnsSchema,
});
export type DatasetRecordForm = z.infer<typeof datasetRecordFormSchema>;

/** Portable span-shaped dataset value used by trace mapping on both sides. */
export const datasetSpanSchema = z.record(z.string(), z.unknown());

export const newDatasetEntriesSchema = z.object({
  entries: z.array(datasetRecordEntrySchema),
});

export const datasetConfirmColumnsSchema = z.array(
  z.object({
    name: z.string(),
    type: datasetColumnTypeSchema,
    sourceHeader: z.string(),
  }),
);
export type DatasetConfirmColumns = z.infer<typeof datasetConfirmColumnsSchema>;

export const datasetStatusSchema = z.enum(["uploading", "processing", "ready", "failed"]);
export type DatasetStatus = z.infer<typeof datasetStatusSchema>;

export const datasetContentLayoutSchema = z.enum(["postgres", "s3_jsonl"]);
export type DatasetContentLayout = z.infer<typeof datasetContentLayoutSchema>;

export type DatasetEntrySelection = "first" | "last" | "random" | "all" | number;

export const datasetSchema = z
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
export type Dataset = z.infer<typeof datasetSchema>;

export const datasetRecordSchema = z
  .object({
    id: z.string().min(1),
    datasetId: z.string().min(1),
    projectId: z.string().min(1),
    entry: z.record(z.string(), z.unknown()),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type DatasetRecord = z.infer<typeof datasetRecordSchema>;

export const datasetSummarySchema = datasetSchema.extend({
  recordCount: z.number().int().nonnegative(),
});
export type DatasetSummary = z.infer<typeof datasetSummarySchema>;

export const datasetPaginationSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export type DatasetPagination = z.infer<typeof datasetPaginationSchema>;

export const datasetListResultSchema = z.object({
  data: z.array(datasetSummarySchema),
  pagination: datasetPaginationSchema,
});
export type DatasetListResult = z.infer<typeof datasetListResultSchema>;

export const datasetRecordPageSchema = z.object({
  data: z.array(datasetRecordSchema),
  pagination: datasetPaginationSchema,
});
export type DatasetRecordPage = z.infer<typeof datasetRecordPageSchema>;

export const datasetPageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  columnTypes: datasetColumnsSchema,
  datasetRecords: z.array(datasetRecordSchema),
  count: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export type DatasetPage = z.infer<typeof datasetPageSchema>;

export const datasetWithRecordsSchema = z.object({
  dataset: datasetSchema,
  records: z.array(datasetRecordSchema),
  truncated: z.boolean(),
});
export type DatasetWithRecords = z.infer<typeof datasetWithRecordsSchema>;

export const datasetHeadSchema = z.object({
  dataset: datasetSchema,
  records: z.array(datasetRecordSchema),
  total: z.number().int().nonnegative(),
});
export type DatasetHead = z.infer<typeof datasetHeadSchema>;

export const datasetRecordMutationResultSchema = z.object({
  record: datasetRecordSchema,
  created: z.boolean(),
});
export type DatasetRecordMutationResult = z.infer<typeof datasetRecordMutationResultSchema>;

export const upsertDatasetInputSchema = z
  .object({
    projectId: z.string().min(1),
    name: z.string().min(1),
    columnTypes: datasetColumnsSchema,
    datasetId: z.string().min(1).optional(),
    datasetRecords: z.array(datasetRecordInputSchema).optional(),
  })
  .strict();
export type UpsertDatasetInput = z.infer<typeof upsertDatasetInputSchema>;

export const datasetNameInputSchema = z
  .object({
    projectId: z.string().min(1),
    proposedName: z.string().min(1),
    excludeDatasetId: z.string().min(1).optional(),
  })
  .strict();
export type DatasetNameInput = z.infer<typeof datasetNameInputSchema>;

export const datasetNameResultSchema = z.object({
  available: z.boolean(),
  slug: z.string().min(1),
  conflictsWith: z.string().min(1).optional(),
});
export type DatasetNameResult = z.infer<typeof datasetNameResultSchema>;

export const datasetLookupInputSchema = z
  .object({ slugOrId: z.string().min(1), projectId: z.string().min(1) })
  .strict();
export type DatasetLookupInput = z.infer<typeof datasetLookupInputSchema>;

export const datasetWithRecordsInputSchema = datasetLookupInputSchema.extend({
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
export type DatasetWithRecordsInput = z.input<typeof datasetWithRecordsInputSchema>;

export const listDatasetsInputSchema = z
  .object({
    projectId: z.string().min(1),
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().max(200).default(50),
  })
  .strict();
export type ListDatasetsInput = z.input<typeof listDatasetsInputSchema>;

export const datasetRecordLookupInputSchema = z
  .object({
    slugOrId: z.string().min(1),
    projectId: z.string().min(1),
  })
  .strict();

export const datasetPageInputSchema = datasetRecordLookupInputSchema.extend({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(200).default(50),
});
export type DatasetPageInput = z.input<typeof datasetPageInputSchema>;

export const createDatasetRecordsInputSchema = datasetRecordLookupInputSchema.extend({
  entries: z.array(datasetRecordInputSchema),
});
export type CreateDatasetRecordsInput = z.infer<typeof createDatasetRecordsInputSchema>;

export const updateDatasetRecordInputSchema = datasetRecordLookupInputSchema.extend({
  recordId: z.string().min(1),
  updatedRecord: z.record(z.string(), z.unknown()),
});
export type UpdateDatasetRecordInput = z.infer<typeof updateDatasetRecordInputSchema>;

export const deleteDatasetRecordsInputSchema = datasetRecordLookupInputSchema.extend({
  recordIds: z.array(z.string().min(1)),
});
export type DeleteDatasetRecordsInput = z.infer<typeof deleteDatasetRecordsInputSchema>;

export const uploadExistingDatasetInputSchema = z.object({
  slugOrId: z.string().min(1),
  projectId: z.string().min(1),
  filename: z.string().min(1),
  content: z.string(),
  fileSize: z.number().nonnegative(),
});
export type UploadExistingDatasetInput = z.infer<typeof uploadExistingDatasetInputSchema>;

export const createDatasetFromUploadInputSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  filename: z.string().min(1),
  content: z.string(),
  fileSize: z.number().nonnegative(),
});
export type CreateDatasetFromUploadInput = z.infer<typeof createDatasetFromUploadInputSchema>;

export type CreateDatasetFromUploadResult = {
  id: string;
  name: string;
  slug: string;
  columnTypes: DatasetColumns;
  createdAt: Date;
  updatedAt: Date;
  recordsCreated: number;
};

export const pendingUploadInputSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  filename: z.string().min(1),
  columnTypes: z
    .array(
      z.object({
        name: z.string(),
        type: datasetColumnTypeSchema,
        sourceHeader: z.string().optional(),
      }),
    )
    .optional(),
});
export type PendingUploadInput = z.infer<typeof pendingUploadInputSchema>;

export type PendingUploadResult = {
  datasetId: string;
  slug: string;
  uploadUrl: string;
};

export type StagedUploadInput = {
  projectId: string;
  uploadId: string;
  body: unknown;
};

export type AbortPendingUploadInput = {
  projectId: string;
  datasetId: string;
};

export type FinalizeUploadInput = {
  projectId: string;
  datasetId: string;
};

export type RetryNormalizeInput = AbortPendingUploadInput;

export const copyDatasetInputSchema = z
  .object({
    sourceDatasetId: z.string().min(1),
    sourceProjectId: z.string().min(1),
    targetProjectId: z.string().min(1),
  })
  .strict();
export type CopyDatasetInput = z.infer<typeof copyDatasetInputSchema>;
