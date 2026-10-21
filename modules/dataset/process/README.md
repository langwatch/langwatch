# @langwatch/dataset-process

The server half of [dataset](../README.md). Datasets and their records: creating, naming, mapping and reading them by slug or id.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("dataset").withRepositories(datasetRepositories).withApi(DatasetModule).withTransports(…, datasetTrpcTransport, datasetRecordTrpcTransport).provideMiddlewareContext(…).withEventing(datasetNormalizationEventing).withMigrations(…)`, `src/dataset.module.ts:18`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`DatasetApi`)

Callable capability exposed by the composed Dataset application.

Peers call these through the token, declared at `../contract/src/dataset.api.ts:78`; nothing else in this package is public.

#### `upsertDataset`

```typescript
upsertDataset(input: { projectId: string; datasetId?: string; slugOrId?: string; name?: string; columnTypes?: DatasetColumns; datasetRecords?: UpsertDatasetInput["datasetRecords"]; }): Promise<Dataset>;
```

#### `validateDatasetName`

```typescript
validateDatasetName(input: DatasetNameInput): Promise<DatasetNameResult>;
```

#### `findNextAvailableName`

```typescript
findNextAvailableName(input: DatasetNameInput): Promise<string>;
```

#### `listDatasets`

```typescript
listDatasets(input: ListDatasetsInput): Promise<DatasetListResult>;
```

#### `findDatasetSummaries`

The same page without entry counts, for the browser's list surfaces (tRPC `getAll`).

```typescript
findDatasetSummaries(input: ListDatasetsInput): Promise<DatasetSummary[]>;
```

#### `countRecords`

Each named dataset's entry count, read apart from the list so the list never waits on it.

```typescript
countRecords(input: CountDatasetRecordsInput): Promise<DatasetRecordCount[]>;
```

#### `getBySlugOrId`

```typescript
getBySlugOrId(input: DatasetLookupInput): Promise<Dataset>;
```

#### `findBySlugOrId`

```typescript
findBySlugOrId(input: DatasetLookupInput): Promise<Dataset | null>;
```

#### `findBySlug`

The dataset holding exactly this slug, archived or not; empty when none does.

```typescript
findBySlug(input: { projectId: string; slug: string }): Promise<Dataset[]>;
```

#### `updateMapping`

```typescript
updateMapping(input: { datasetId: string; projectId: string; mapping?: { mapping: Record<string, unknown>; expansions: string[] }; threadMapping?: { mapping: Record<string, unknown> }; }): Promise<Dataset>;
```

#### `archiveDataset`

```typescript
archiveDataset(input: DatasetLookupInput): Promise<{ id: string; archived: true }>;
```

#### `restoreDataset`

```typescript
restoreDataset(input: { datasetId: string; projectId: string }): Promise<{ success: true }>;
```

#### `archiveOrRestoreDataset`

Archives the dataset, or restores it when `undo` is set (tRPC `deleteById`).

```typescript
archiveOrRestoreDataset(input: DatasetApiDeleteInput): Promise<{ success: true }>;
```

#### `copyDataset`

```typescript
copyDataset(input: CopyDatasetInput): Promise<Dataset>;
```

#### `copyDatasetForActor`

The same copy, on behalf of a person: the caller's reach into the SOURCE project is probed before anything is read from it, which a door's declared check — made against the target — never covers.

```typescript
copyDatasetForActor(input: CopyDatasetInput & { actorId: string }): Promise<Dataset>;
```

#### `getDatasetWithRecords`

```typescript
getDatasetWithRecords(input: DatasetLookupInput & { limitMb?: number | null; entrySelection?: DatasetEntrySelection; }): Promise<DatasetWithRecords>;
```

#### `getDatasetWithinLimit`

The whole dataset in one answer, refused rather than truncated when it is larger than the organization answers inline.

```typescript
getDatasetWithinLimit(input: DatasetLookupInput): Promise<DatasetWithRecords>;
```

#### `getLimits`

The size limits the project's organization answers.

```typescript
getLimits(input: { projectId: string }): Promise<DatasetLimits>;
```

#### `createAttachmentUpload`

The signed upload a cell's file is sent to, within the organization's per-file limit.

```typescript
createAttachmentUpload(input: CreateDatasetAttachmentUploadInput): Promise<StoredObjectsCreateUploadOutput>;
```

#### `getDatasetPage`

```typescript
getDatasetPage(input: DatasetPageInput): Promise<DatasetPage>;
```

#### `findDatasetPage`

```typescript
findDatasetPage(input: DatasetPageInput): Promise<DatasetPage | null>;
```

#### `getDatasetHead`

```typescript
getDatasetHead(input: DatasetLookupInput): Promise<DatasetHead>;
```

#### `listRecords`

```typescript
listRecords(input: DatasetPageInput): Promise<DatasetRecordPage>;
```

#### `batchCreateRecords`

```typescript
batchCreateRecords(input: CreateDatasetRecordsInput): Promise<DatasetRecord[]>;
```

#### `upsertRecord`

```typescript
upsertRecord(input: UpdateDatasetRecordInput & { recordId: string }): Promise<DatasetRecordMutationResult>;
```

#### `deleteRecords`

```typescript
deleteRecords(input: DeleteDatasetRecordsInput): Promise<{ count: number }>;
```

#### `deleteMatchingRecords`

Entries removed by id, refused with a 404 when none matched.

```typescript
deleteMatchingRecords(input: DeleteDatasetRecordsInput): Promise<{ deletedCount: number }>;
```

#### `createDatasetFromUpload`

Deprecated with the multipart upload routes; retires in the next release (ADR-158 §8).

```typescript
createDatasetFromUpload(input: CreateDatasetFromUploadInput): Promise<CreateDatasetFromUploadResult>;
```

#### `uploadToExistingDataset`

Deprecated with the multipart upload routes; retires in the next release (ADR-158 §8).

```typescript
uploadToExistingDataset(input: UploadExistingDatasetInput): Promise<{ datasetId: string; recordsCreated: number }>;
```

#### `createDatasetFromStoredObject`

```typescript
createDatasetFromStoredObject(input: CreateDatasetFromStoredObjectInput): Promise<DatasetImportStarted>;
```

#### `storeAttachmentUpload`

Deprecated with `POST /api/dataset/attachments`; retires in the next release (ADR-158 §8).

```typescript
storeAttachmentUpload(input: StoreDatasetAttachmentUploadInput): Promise<StoredDatasetAttachment>;
```

#### `appendStoredObjectToDataset`

```typescript
appendStoredObjectToDataset(input: AppendStoredObjectToDatasetInput): Promise<DatasetImportAppended>;
```

#### `retryNormalize`

```typescript
retryNormalize(input: RetryNormalizeInput): Promise<UploadProcessing>;
```

#### `getByIds`

```typescript
getByIds(input: { projectId: string; datasetIds: string[] }): Promise<Dataset[]>;
```

#### `renameDataset`

```typescript
renameDataset(input: { datasetId: string; projectId: string; name: string }): Promise<Dataset>;
```

#### `summariseBatchEvaluations`

One row per experiment and dataset: how many ran, total cost, mean score.

```typescript
summariseBatchEvaluations(input: { projectId: string }): Promise<BatchEvaluationSummary[]>;
```

#### `createBatchEvaluation`

One batch-evaluation row, written as `POST /api/dataset/evaluate` records it.

```typescript
createBatchEvaluation(input: BatchEvaluationEntry): Promise<void>;
```

#### `listBatchEvaluations`

Every batch-evaluation record of one experiment; experiment resolves the slug.

```typescript
listBatchEvaluations(input: { projectId: string; experimentId: string; }): Promise<BatchEvaluationRecord[]>;
```

#### `platformUrl`

The platform's own address for one dataset resource, built from the project's slug and a caller-resolved path. The REST declaration is static with no request-scoped builder, so the app composes this link.

```typescript
platformUrl(input: { projectSlug: string; path: string }): string;
```

#### `listStoragePage`

One id-ordered page of the project's datasets for a storage migration's inventory, archived ones included: they remain recoverable customer data.

```typescript
listStoragePage(input: DatasetStoragePageInput): Promise<DatasetStorageEntry[]>;
```

#### `countUsage`

The usage report's figures for these projects.

```typescript
countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<DatasetUsageCount>;
```

## REST transport

### `createDatasetRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/dataset.rest.ts:143`    |
| Base URL    | `/api/dataset`, twin `/api/v1/dataset` |
| Addressing  | dated                                  |
| Credential  | project                                |
| Versions    | `2026-08-07`                           |

#### `GET /` · `getApiDataset`

List all non-archived datasets for the project (paginated)

Permission `datasets:view`. Declared at `src/transport/dataset.rest.ts:147`.

Answers at `/api/dataset`, `/api/v1/dataset`; also, undocumented, `/api/dataset/2026-08-07`, `/api/v1/dataset/2026-08-07`, `/api/dataset/latest`, `/api/v1/dataset/latest`.

```typescript
// Query: datasetRestPaginationQuerySchema, ../contract/src/dataset-rest.schemas.ts:56
interface Query {
  page?: number;
  limit?: number;
}
type Response = z.infer<typeof datasetRestListResponseSchema>; // ../contract/src/dataset-rest.schemas.ts:243
```

#### `POST /` · `postApiDataset`

Create a new dataset

Permission `datasets:create`. Declared at `src/transport/dataset.rest.ts:180`.

Answers at `/api/dataset`, `/api/v1/dataset`; also, undocumented, `/api/dataset/2026-08-07`, `/api/v1/dataset/2026-08-07`, `/api/dataset/latest`, `/api/v1/dataset/latest`.

```typescript
type Body = z.infer<typeof datasetRestCreateSchema>; // ../contract/src/dataset-rest.schemas.ts:39
type Response = z.infer<typeof datasetRestSummarySchema>; // ../contract/src/dataset-rest.schemas.ts:230
```

#### `POST /:slugOrId/records` · `postApiDatasetBySlugOrIdRecords`

Create records in a dataset in batch

Permission `datasets:update`. Declared at `src/transport/dataset.rest.ts:209`.

Answers at `/api/dataset/:slugOrId/records`, `/api/v1/dataset/:slugOrId/records`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId/records`, `/api/v1/dataset/2026-08-07/:slugOrId/records`, `/api/dataset/latest/:slugOrId/records`, `/api/v1/dataset/latest/:slugOrId/records`.

```typescript
// Params: datasetRestSlugOrIdParamsSchema, ../contract/src/dataset-rest.schemas.ts:105
interface Params {
  slugOrId: string;
}
// Body: datasetRestBatchCreateRecordsSchema, ../contract/src/dataset-rest.schemas.ts:68
interface Body {
  entries: Record<string, unknown>[];
}
// Response: datasetRestRecordsCreatedSchema, ../contract/src/dataset-rest.schemas.ts:264
interface Response {
  data: {
    id: string;
    datasetId: string;
    projectId: string;
    entry: Record<string, unknown>;
    createdAt: unknown;
    updatedAt: unknown;
  }[];
}
```

#### `POST /:datasetSlug/entries` · `postApiDatasetBySlugEntries`

Add entries to a dataset

Permission `datasets:update`. Declared at `src/transport/dataset.rest.ts:232`.

Answers at `/api/dataset/:datasetSlug/entries`, `/api/v1/dataset/:datasetSlug/entries`; also, undocumented, `/api/dataset/2026-08-07/:datasetSlug/entries`, `/api/v1/dataset/2026-08-07/:datasetSlug/entries`, `/api/dataset/latest/:datasetSlug/entries`, `/api/v1/dataset/latest/:datasetSlug/entries`.

```typescript
// Params: datasetRestSlugParamsSchema, ../contract/src/dataset-rest.schemas.ts:111
interface Params {
  datasetSlug: string;
}
// Body: datasetRestLegacyEntriesSchema, ../contract/src/dataset-rest.schemas.ts:98
type Body = BodyDatasetPostEntries;
type BodyDatasetPostEntries = {
  entries: Record<string, unknown>[];
};
// Response: datasetRestEntriesAddedSchema, ../contract/src/dataset-rest.schemas.ts:272
interface Response {
  success: true;
}
```

#### `POST /imports` · `postApiDatasetImports`

Create a dataset from an uploaded file

Permission `datasets:create`. Declared at `src/transport/dataset.rest.ts:254`.

Answers at `/api/dataset/imports`, `/api/v1/dataset/imports`; also, undocumented, `/api/dataset/2026-08-07/imports`, `/api/v1/dataset/2026-08-07/imports`, `/api/dataset/latest/imports`, `/api/v1/dataset/latest/imports`.

```typescript
type Body = z.infer<typeof datasetRestImportSchema>; // ../contract/src/dataset-rest.schemas.ts:139
// Response: datasetImportStartedSchema, ../contract/src/dataset.ts:631
interface Response {
  datasetId: string;
  slug: string;
  status: "processing";
}
```

#### `POST /:slugOrId/imports` · `postApiDatasetBySlugOrIdImports`

Import an uploaded file into a dataset

Permission `datasets:update`. Declared at `src/transport/dataset.rest.ts:269`.

Answers at `/api/dataset/:slugOrId/imports`, `/api/v1/dataset/:slugOrId/imports`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId/imports`, `/api/v1/dataset/2026-08-07/:slugOrId/imports`, `/api/dataset/latest/:slugOrId/imports`, `/api/v1/dataset/latest/:slugOrId/imports`.

```typescript
type Params = z.infer<typeof datasetRestSlugOrIdParamsSchema>; // ../contract/src/dataset-rest.schemas.ts:105
// Body: datasetRestAppendImportSchema, ../contract/src/dataset-rest.schemas.ts:149
type Body = BodyDatasetAppendImport;
type BodyDatasetAppendImport = {
  storedObjectId: string;
};
// Response: datasetImportAppendedSchema, ../contract/src/dataset.ts:657
interface Response {
  datasetId: string;
  recordsCreated: number;
}
```

#### `POST /upload` · `postApiDatasetUpload`

Create a new dataset from an uploaded file (CSV, JSON, JSONL)

Permission `datasets:create`. Deprecated. Declared at `src/transport/dataset.rest.ts:286`.

Answers at `/api/dataset/upload`, `/api/v1/dataset/upload`; also, undocumented, `/api/dataset/2026-08-07/upload`, `/api/v1/dataset/2026-08-07/upload`, `/api/dataset/latest/upload`, `/api/v1/dataset/latest/upload`.

```typescript
// Multipart: { fields: datasetRestUploadFieldsSchema, files: { file: { required: true } } } (inline, src/transport/dataset.rest.ts:289)
type Response = z.infer<typeof datasetRestUploadCreatedSchema>; // ../contract/src/dataset-rest.schemas.ts:214
```

#### `POST /:slugOrId/upload` · `postApiDatasetBySlugOrIdUpload`

Upload a file (CSV, JSON, JSONL) to an existing dataset

Permission `datasets:update`. Deprecated. Declared at `src/transport/dataset.rest.ts:306`.

Answers at `/api/dataset/:slugOrId/upload`, `/api/v1/dataset/:slugOrId/upload`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId/upload`, `/api/v1/dataset/2026-08-07/:slugOrId/upload`, `/api/dataset/latest/:slugOrId/upload`, `/api/v1/dataset/latest/:slugOrId/upload`.

```typescript
type Params = z.infer<typeof datasetRestSlugOrIdParamsSchema>; // ../contract/src/dataset-rest.schemas.ts:105
// Multipart: { fields: datasetRestNoUploadFieldsSchema, files: { file: { required: true } }, } (inline, src/transport/dataset.rest.ts:310)
type Response = z.infer<typeof datasetImportAppendedSchema>; // ../contract/src/dataset.ts:657
```

#### `POST /attachments` · `postApiDatasetAttachments`

Upload a file for an image or file column and get the reference a cell holds. The project is named by the `projectId` query parameter; the file goes in the `file` multipart field, with an optional `datasetId` field.

Permission `datasets:manage`. Deprecated. Declared at `src/transport/dataset.rest.ts:331`.

Answers at `/api/dataset/attachments`, `/api/v1/dataset/attachments`; also, undocumented, `/api/dataset/2026-08-07/attachments`, `/api/v1/dataset/2026-08-07/attachments`, `/api/dataset/latest/attachments`, `/api/v1/dataset/latest/attachments`.

```typescript
// Query: datasetRestAttachmentQuerySchema, ../contract/src/dataset-rest.schemas.ts:174
interface Query {
  projectId: string;
}
// Multipart: { fields: datasetRestAttachmentFieldsSchema, files: { file: { required: true } }, } (inline, src/transport/dataset.rest.ts:335)
// Response: storedDatasetAttachmentSchema, ../contract/src/dataset.ts:560
type Response = ResponseDatasetAttachment;
type ResponseDatasetAttachment = {
  url: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
};
```

#### `POST /attachments/uploads` · `postApiDatasetAttachmentsUploads`

Create an upload for an image or file cell

Permission `datasets:update`. Declared at `src/transport/dataset.rest.ts:374`.

Answers at `/api/dataset/attachments/uploads`, `/api/v1/dataset/attachments/uploads`; also, undocumented, `/api/dataset/2026-08-07/attachments/uploads`, `/api/v1/dataset/2026-08-07/attachments/uploads`, `/api/dataset/latest/attachments/uploads`, `/api/v1/dataset/latest/attachments/uploads`.

```typescript
// Body: datasetRestAttachmentUploadSchema, ../contract/src/dataset-rest.schemas.ts:198
interface Body {
  filename: string;
  mediaType: string;
  byteLength: number;
}
// Response: datasetAttachmentUploadSchema, ../contract/src/dataset.ts:595
interface Response {
  objectId: string;
  uploadUrl: string;
  method: "PUT";
  headers?: Record<string, string>;
  expiresAt: string;
}
```

#### `GET /:slugOrId` · `getApiDatasetBySlugOrId`

Get a dataset by its slug or id, with every record inline. A dataset too large for one response is refused: read it page by page from `GET /{slugOrId}/records`.

Permission `datasets:view`. Declared at `src/transport/dataset.rest.ts:396`.

Answers at `/api/dataset/:slugOrId`, `/api/v1/dataset/:slugOrId`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId`, `/api/v1/dataset/2026-08-07/:slugOrId`, `/api/dataset/latest/:slugOrId`, `/api/v1/dataset/latest/:slugOrId`.

```typescript
type Params = z.infer<typeof datasetRestSlugOrIdParamsSchema>; // ../contract/src/dataset-rest.schemas.ts:105
type Response = z.infer<typeof datasetRestDetailResponseSchema>; // ../contract/src/dataset-rest.schemas.ts:254
```

#### `PATCH /:slugOrId` · `patchApiDatasetBySlugOrId`

Update a dataset by its slug or id

Permission `datasets:manage`. Declared at `src/transport/dataset.rest.ts:426`.

Answers at `/api/dataset/:slugOrId`, `/api/v1/dataset/:slugOrId`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId`, `/api/v1/dataset/2026-08-07/:slugOrId`, `/api/dataset/latest/:slugOrId`, `/api/v1/dataset/latest/:slugOrId`.

```typescript
type Params = z.infer<typeof datasetRestSlugOrIdParamsSchema>; // ../contract/src/dataset-rest.schemas.ts:105
type Body = z.infer<typeof datasetRestUpdateSchema>; // ../contract/src/dataset-rest.schemas.ts:46
type Response = z.infer<typeof datasetRestSummarySchema>; // ../contract/src/dataset-rest.schemas.ts:230
```

#### `DELETE /:slugOrId` · `deleteApiDatasetBySlugOrId`

Archive a dataset (soft-delete)

Permission `datasets:manage`. Declared at `src/transport/dataset.rest.ts:467`.

Answers at `/api/dataset/:slugOrId`, `/api/v1/dataset/:slugOrId`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId`, `/api/v1/dataset/2026-08-07/:slugOrId`, `/api/dataset/latest/:slugOrId`, `/api/v1/dataset/latest/:slugOrId`.

```typescript
type Params = z.infer<typeof datasetRestSlugOrIdParamsSchema>; // ../contract/src/dataset-rest.schemas.ts:105
// Response: datasetRestArchivedSchema, ../contract/src/dataset-rest.schemas.ts:296
interface Response {
  id: string;
  archived: true;
}
```

#### `GET /:slugOrId/records` · `getApiDatasetBySlugOrIdRecords`

List records for a dataset (paginated). Each page also carries the dataset itself. A page too large for one response is refused with `dataset_page_too_large`: ask again with the smaller `limit` the error names.

Permission `datasets:view`. Declared at `src/transport/dataset.rest.ts:484`.

Answers at `/api/dataset/:slugOrId/records`, `/api/v1/dataset/:slugOrId/records`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId/records`, `/api/v1/dataset/2026-08-07/:slugOrId/records`, `/api/dataset/latest/:slugOrId/records`, `/api/v1/dataset/latest/:slugOrId/records`.

```typescript
type Params = z.infer<typeof datasetRestSlugOrIdParamsSchema>; // ../contract/src/dataset-rest.schemas.ts:105
type Query = z.infer<typeof datasetRestPaginationQuerySchema>; // ../contract/src/dataset-rest.schemas.ts:56
type Response = z.infer<typeof datasetRestRecordPageSchema>; // ../contract/src/dataset-rest.schemas.ts:285
```

#### `GET /:datasetSlug/entries` · `getApiDatasetBySlugEntries`

List entries of a dataset (paginated). Same as GET /:slugOrId/records.

Permission `datasets:view`. Declared at `src/transport/dataset.rest.ts:509`.

Answers at `/api/dataset/:datasetSlug/entries`, `/api/v1/dataset/:datasetSlug/entries`; also, undocumented, `/api/dataset/2026-08-07/:datasetSlug/entries`, `/api/v1/dataset/2026-08-07/:datasetSlug/entries`, `/api/dataset/latest/:datasetSlug/entries`, `/api/v1/dataset/latest/:datasetSlug/entries`.

```typescript
type Params = z.infer<typeof datasetRestSlugParamsSchema>; // ../contract/src/dataset-rest.schemas.ts:111
type Query = z.infer<typeof datasetRestPaginationQuerySchema>; // ../contract/src/dataset-rest.schemas.ts:56
type Response = z.infer<typeof datasetRestRecordPageSchema>; // ../contract/src/dataset-rest.schemas.ts:285
```

#### `PATCH /:slugOrId/records/:recordId` · `patchApiDatasetBySlugOrIdRecordsByRecordId`

Update or create a record in a dataset

Permission `datasets:update`. Declared at `src/transport/dataset.rest.ts:532`.

Answers at `/api/dataset/:slugOrId/records/:recordId`, `/api/v1/dataset/:slugOrId/records/:recordId`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId/records/:recordId`, `/api/v1/dataset/2026-08-07/:slugOrId/records/:recordId`, `/api/dataset/latest/:slugOrId/records/:recordId`, `/api/v1/dataset/latest/:slugOrId/records/:recordId`.

```typescript
// Params: datasetRestRecordParamsSchema, ../contract/src/dataset-rest.schemas.ts:122
interface Params {
  slugOrId: string;
  recordId: string;
}
// Body: datasetRestUpdateRecordSchema, ../contract/src/dataset-rest.schemas.ts:132
interface Body {
  entry: Record<string, unknown>;
}
```

#### `DELETE /:slugOrId/records` · `deleteApiDatasetBySlugOrIdRecords`

Delete records from a dataset by IDs

Permission `datasets:manage`. Declared at `src/transport/dataset.rest.ts:552`.

Answers at `/api/dataset/:slugOrId/records`, `/api/v1/dataset/:slugOrId/records`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId/records`, `/api/v1/dataset/2026-08-07/:slugOrId/records`, `/api/dataset/latest/:slugOrId/records`, `/api/v1/dataset/latest/:slugOrId/records`.

```typescript
type Params = z.infer<typeof datasetRestSlugOrIdParamsSchema>; // ../contract/src/dataset-rest.schemas.ts:105
// Body: datasetRestDeleteRecordsSchema, ../contract/src/dataset-rest.schemas.ts:80
interface Body {
  recordIds: string[];
}
// Response: datasetRestRecordsDeletedSchema, ../contract/src/dataset-rest.schemas.ts:306
interface Response {
  deletedCount: number;
}
```

## tRPC transport

### `datasetRecord`

Contract `../contract/src/dataset-record.trpc.ts:32`, router `src/transport/dataset-record.trpc.ts:13`.

| Procedure                     | Kind     | Gate                         | Input                                   | Output                              |
| ----------------------------- | -------- | ---------------------------- | --------------------------------------- | ----------------------------------- |
| `datasetRecord.create`        | mutation | Permission `datasets:create` | `datasetRecordApiCreateInputSchema`     | inline                              |
| `datasetRecord.update`        | mutation | Permission `datasets:update` | `datasetRecordApiUpdateInputSchema`     | `datasetRecordMutationResultSchema` |
| `datasetRecord.getAll`        | query    | Permission `datasets:view`   | `datasetRecordApiLookupInputSchema`     | `datasetRecordEditorReadSchema`     |
| `datasetRecord.listPaginated` | query    | Permission `datasets:view`   | `datasetRecordApiPageInputSchema`       | inline                              |
| `datasetRecord.download`      | mutation | Permission `datasets:view`   | `datasetRecordApiLookupInputSchema`     | `datasetRecordEditorReadSchema`     |
| `datasetRecord.getHead`       | query    | Permission `datasets:view`   | `datasetRecordApiLookupInputSchema`     | `datasetRecordHeadReadSchema`       |
| `datasetRecord.deleteMany`    | mutation | Permission `datasets:delete` | `datasetRecordApiDeleteManyInputSchema` | `datasetRecordsDeletedSchema`       |

```typescript
// datasetRecord.create
// Input: datasetRecordApiCreateInputSchema, ../contract/src/dataset.schemas.ts:143
interface Input {
  projectId: string;
  datasetId: string;
  entries: (Record<string, unknown> & {
    id: string;
  })[];
}
// Output: inline, ../contract/src/dataset-record.trpc.ts:36
type Output = {
  id: string;
  datasetId: string;
  projectId: string;
  entry: Record<string, unknown>;
  createdAt: unknown;
  updatedAt: unknown;
}[];

// datasetRecord.update
// Input: datasetRecordApiUpdateInputSchema, ../contract/src/dataset.schemas.ts:156
interface Input {
  projectId: string;
  datasetId: string;
  recordId: string;
  updatedRecord: Record<string, unknown>;
}
// Output: datasetRecordMutationResultSchema, ../contract/src/dataset.ts:356
interface Output {
  record: {
    id: string;
    datasetId: string;
    projectId: string;
    entry: Record<string, unknown>;
    createdAt: unknown;
    updatedAt: unknown;
  };
  created: boolean;
}

// datasetRecord.getAll
// Input: datasetRecordApiLookupInputSchema, ../contract/src/dataset.schemas.ts:167
interface Input {
  projectId: string;
  datasetId: string;
}
type Output = z.infer<typeof datasetRecordEditorReadSchema>; // ../contract/src/dataset.responses.ts:27

// datasetRecord.listPaginated
// Input: datasetRecordApiPageInputSchema, ../contract/src/dataset.schemas.ts:181
interface Input {
  projectId: string;
  datasetId: string;
  page?: number;
  limit?: number;
  search?: string;
}
// Output: datasetPageSchema.nullable() (inline, ../contract/src/dataset-record.trpc.ts:51)

// datasetRecord.download
type Input = z.infer<typeof datasetRecordApiLookupInputSchema>; // ../contract/src/dataset.schemas.ts:167
type Output = z.infer<typeof datasetRecordEditorReadSchema>; // ../contract/src/dataset.responses.ts:27

// datasetRecord.getHead
type Input = z.infer<typeof datasetRecordApiLookupInputSchema>; // ../contract/src/dataset.schemas.ts:167
type Output = z.infer<typeof datasetRecordHeadReadSchema>; // ../contract/src/dataset.responses.ts:40

// datasetRecord.deleteMany
// Input: datasetRecordApiDeleteManyInputSchema, ../contract/src/dataset.schemas.ts:193
interface Input {
  projectId: string;
  datasetId: string;
  recordIds: string[];
}
// Output: datasetRecordsDeletedSchema, ../contract/src/dataset-record.trpc.ts:30
interface Output {
  count: number;
}
```

### `dataset`

Contract `../contract/src/dataset.trpc.ts:44`, router `src/transport/dataset.trpc.ts:11`.

| Procedure                        | Kind     | Gate                         | Input                                      | Output                          |
| -------------------------------- | -------- | ---------------------------- | ------------------------------------------ | ------------------------------- |
| `dataset.upsert`                 | mutation | Permission `datasets:manage` | inline                                     | `datasetWireSchema`             |
| `dataset.validateDatasetName`    | query    | Permission `datasets:view`   | `datasetApiValidateNameInputSchema`        | `datasetNameResultSchema`       |
| `dataset.getAll`                 | query    | Permission `datasets:view`   | `datasetApiProjectInputSchema`             | inline                          |
| `dataset.recordCounts`           | query    | Permission `datasets:view`   | `countDatasetRecordsInputSchema`           | inline                          |
| `dataset.getById`                | query    | Permission `datasets:view`   | `datasetApiDatasetInputSchema`             | inline                          |
| `dataset.deleteById`             | mutation | Permission `datasets:delete` | `datasetApiDeleteInputSchema`              | `datasetDeletedSchema`          |
| `dataset.updateMapping`          | mutation | Permission `datasets:update` | `datasetApiUpdateMappingInputSchema`       | `datasetWireSchema`             |
| `dataset.findNextName`           | query    | Permission `datasets:view`   | `datasetApiFindNextNameInputSchema`        | inline                          |
| `dataset.copy`                   | mutation | Permission `datasets:create` | `datasetApiCopyInputSchema`                | `datasetWireSchema`             |
| `dataset.createFromStoredObject` | mutation | Permission `datasets:manage` | `createDatasetFromStoredObjectInputSchema` | `datasetImportStartedSchema`    |
| `dataset.appendStoredObject`     | mutation | Permission `datasets:update` | `appendStoredObjectToDatasetInputSchema`   | `datasetImportAppendedSchema`   |
| `dataset.getLimits`              | query    | Permission `datasets:view`   | `datasetApiProjectInputSchema`             | `datasetLimitsSchema`           |
| `dataset.createAttachmentUpload` | mutation | Permission `datasets:update` | `createDatasetAttachmentUploadInputSchema` | `datasetAttachmentUploadSchema` |
| `dataset.retryNormalize`         | mutation | Permission `datasets:manage` | `retryNormalizeInputSchema`                | `uploadProcessingSchema`        |

```typescript
// dataset.upsert
// Input: z.object({ ...datasetApiUpsertBaseInputSchema.shape, ...datasetApiUpsertTargetInputSchema… (inline, ../contract/src/dataset.trpc.ts:48)
type Output = z.infer<typeof datasetWireSchema>; // ../contract/src/dataset.ts:206

// dataset.validateDatasetName
// Input: datasetApiValidateNameInputSchema, ../contract/src/dataset.schemas.ts:59
interface Input {
  projectId: string;
  proposedName: string;
  excludeDatasetId?: string;
}
// Output: datasetNameResultSchema, ../contract/src/dataset.ts:392
interface Output {
  available: boolean;
  slug: string;
  conflictsWith?: string;
}

// dataset.getAll
// Input: datasetApiProjectInputSchema, ../contract/src/dataset.schemas.ts:67
interface Input {
  projectId: string;
}
// Output: z.array(datasetSummaryWireSchema) (inline, ../contract/src/dataset.trpc.ts:63)

// dataset.recordCounts
// Input: countDatasetRecordsInputSchema, ../contract/src/dataset.ts:259
interface Input {
  projectId: string;
  datasetIds: string[];
}
// Output: inline, ../contract/src/dataset.trpc.ts:68
type Output = {
  datasetId: string;
  recordCount: number;
}[];

// dataset.getById
// Input: datasetApiDatasetInputSchema, ../contract/src/dataset.schemas.ts:78
interface Input {
  projectId: string;
  datasetId: string;
}
// Output: datasetWireSchema.nullable() (inline, ../contract/src/dataset.trpc.ts:73)

// dataset.deleteById
// Input: datasetApiDeleteInputSchema, ../contract/src/dataset.schemas.ts:89
interface Input {
  projectId: string;
  datasetId: string;
  undo?: boolean;
}
// Output: datasetDeletedSchema, ../contract/src/dataset.trpc.ts:42
interface Output {
  success: true;
}

// dataset.updateMapping
// Input: datasetApiUpdateMappingInputSchema, ../contract/src/dataset.schemas.ts:110
interface Input {
  projectId: string;
  datasetId: string;
  mapping?: {
    mapping: Record<string, unknown>;
    expansions: string[];
  };
  threadMapping?: {
    mapping: Record<string, unknown>;
  };
}
type Output = z.infer<typeof datasetWireSchema>; // ../contract/src/dataset.ts:206

// dataset.findNextName
// Input: datasetApiFindNextNameInputSchema, ../contract/src/dataset.schemas.ts:120
interface Input {
  projectId: string;
  proposedName: string;
}
// Output: inline, ../contract/src/dataset.trpc.ts:88
type Output = string;

// dataset.copy
// Input: datasetApiCopyInputSchema, ../contract/src/dataset.schemas.ts:131
interface Input {
  datasetId: string;
  sourceProjectId: string;
  projectId: string;
}
type Output = z.infer<typeof datasetWireSchema>; // ../contract/src/dataset.ts:206

// dataset.createFromStoredObject
type Input = z.infer<typeof createDatasetFromStoredObjectInputSchema>; // ../contract/src/dataset.ts:617
type Output = z.infer<typeof datasetImportStartedSchema>; // ../contract/src/dataset.ts:631

// dataset.appendStoredObject
// Input: appendStoredObjectToDatasetInputSchema, ../contract/src/dataset.ts:644
interface Input {
  projectId: string;
  slugOrId: string;
  storedObjectId: string;
}
type Output = z.infer<typeof datasetImportAppendedSchema>; // ../contract/src/dataset.ts:657

// dataset.getLimits
type Input = z.infer<typeof datasetApiProjectInputSchema>; // ../contract/src/dataset.schemas.ts:67
// Output: datasetLimitsSchema, ../contract/src/dataset-limits.ts:33
interface Output {
  attachmentBytes: number;
  rowBytes: number;
  fileBytes: number;
  jsonFileBytes: number;
  inlineReadBytes: number;
  wholeReadBytes: number;
  rowsMax: number;
}

// dataset.createAttachmentUpload
// Input: createDatasetAttachmentUploadInputSchema, ../contract/src/dataset.ts:576
interface Input {
  projectId: string;
  filename: string;
  mediaType: string;
  byteLength: number;
}
type Output = z.infer<typeof datasetAttachmentUploadSchema>; // ../contract/src/dataset.ts:595

// dataset.retryNormalize
// Input: retryNormalizeInputSchema, ../contract/src/dataset.ts:677
interface Input {
  projectId: string;
  datasetId: string;
}
// Output: uploadProcessingSchema, ../contract/src/dataset.ts:665
interface Output {
  datasetId: string;
  status: "processing";
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `dataset_normalization` (aggregate `dataset`)

Declared at `src/eventing/dataset-normalization.pipeline.ts:33`. Events: `datasetNormalizationSettledEventSchema`.

| Kind         | Name                                                                                           | Handles | Declared at                                         |
| ------------ | ---------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------- |
| command      | –                                                                                              | –       | `src/eventing/dataset-normalization.pipeline.ts:38` |
| lane aliases | `≈ [ { from: "trace_processing:job:datasetNormalize", to: { jobType: "command", lane: "datas…` | –       | `src/eventing/dataset-normalization.pipeline.ts:45` |

## Configuration

| Kind   | Leaf                            | Environment variable    | Declared at                            |
| ------ | ------------------------------- | ----------------------- | -------------------------------------- |
| config | `publicBaseUrl`                 | `BASE_HOST`             | `../contract/src/dataset.config.ts:11` |
| config | `singleFileStorage.onLocalDisk` | `DATASET_STORAGE_LOCAL` | `../contract/src/dataset.config.ts:14` |
| config | `singleFileStorage.localPath`   | `LOCAL_STORAGE_PATH`    | `../contract/src/dataset.config.ts:15` |

<!-- readme:generated:end -->
