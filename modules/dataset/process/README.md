# @langwatch/dataset-process

The server half of [dataset](../README.md). Datasets and their records: creating, naming, mapping and reading them by slug or id.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("dataset").withRepositories(datasetRepositories).withApi(DatasetModule).withTransports(…, datasetTrpcTransport, datasetRecordTrpcTransport).withEventing(datasetNormalizationEventing).withTasks(…)`, `src/dataset.module.ts:12`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`DatasetApi`)

Callable capability exposed by the composed Dataset application.

Peers call these through the token, declared at `../contract/src/dataset.api.ts:73`; nothing else in this package is public.

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

#### `countUsage`

The usage report's figures for these projects.

```typescript
countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<DatasetUsageCount>;
```

## REST transport

### `createDatasetRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/dataset.rest.ts:142`    |
| Base URL    | `/api/dataset`, twin `/api/v1/dataset` |
| Addressing  | dated                                  |
| Credential  | project                                |
| Versions    | `2026-08-07`                           |

#### `GET /` · `getApiDataset`

List all non-archived datasets for the project (paginated)

Permission `datasets:view`. Declared at `src/transport/dataset.rest.ts:146`.

Answers at `/api/dataset`, `/api/v1/dataset`; also, undocumented, `/api/dataset/2026-08-07`, `/api/v1/dataset/2026-08-07`, `/api/dataset/latest`, `/api/v1/dataset/latest`.

```typescript
// Query: datasetRestPaginationQuerySchema, ../contract/src/dataset-rest.schemas.ts:43
interface Query {
  page?: number;
  limit?: number;
}
type Response = z.infer<typeof datasetRestListResponseSchema>; // ../contract/src/dataset-rest.schemas.ts:146
```

#### `POST /` · `postApiDataset`

Create a new dataset

Permission `datasets:create`. Declared at `src/transport/dataset.rest.ts:179`.

Answers at `/api/dataset`, `/api/v1/dataset`; also, undocumented, `/api/dataset/2026-08-07`, `/api/v1/dataset/2026-08-07`, `/api/dataset/latest`, `/api/v1/dataset/latest`.

```typescript
type Body = z.infer<typeof datasetRestCreateSchema>; // ../contract/src/dataset-rest.schemas.ts:33
type Response = z.infer<typeof datasetRestSummarySchema>; // ../contract/src/dataset-rest.schemas.ts:135
```

#### `POST /:slugOrId/records` · `postApiDatasetBySlugOrIdRecords`

Create records in a dataset in batch

Permission `datasets:update`. Declared at `src/transport/dataset.rest.ts:206`.

Answers at `/api/dataset/:slugOrId/records`, `/api/v1/dataset/:slugOrId/records`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId/records`, `/api/v1/dataset/2026-08-07/:slugOrId/records`, `/api/dataset/latest/:slugOrId/records`, `/api/v1/dataset/latest/:slugOrId/records`.

```typescript
// Params: datasetRestSlugOrIdParamsSchema, ../contract/src/dataset-rest.schemas.ts:75
interface Params {
  slugOrId: string;
}
// Body: datasetRestBatchCreateRecordsSchema, ../contract/src/dataset-rest.schemas.ts:48
interface Body {
  entries: Record<string, unknown>[];
}
// Response: datasetRestRecordsCreatedSchema, ../contract/src/dataset-rest.schemas.ts:160
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

Permission `datasets:update`. Declared at `src/transport/dataset.rest.ts:227`.

Answers at `/api/dataset/:datasetSlug/entries`, `/api/v1/dataset/:datasetSlug/entries`; also, undocumented, `/api/dataset/2026-08-07/:datasetSlug/entries`, `/api/v1/dataset/2026-08-07/:datasetSlug/entries`, `/api/dataset/latest/:datasetSlug/entries`, `/api/v1/dataset/latest/:datasetSlug/entries`.

```typescript
// Params: datasetRestSlugParamsSchema, ../contract/src/dataset-rest.schemas.ts:76
interface Params {
  datasetSlug: string;
}
// Body: datasetRestLegacyEntriesSchema, ../contract/src/dataset-rest.schemas.ts:63
type Body = BodyDatasetPostEntries;
type BodyDatasetPostEntries = {
  entries: Record<string, unknown>[];
};
// Response: datasetRestEntriesAddedSchema, ../contract/src/dataset-rest.schemas.ts:165
interface Response {
  success: true;
}
```

#### `POST /imports` · `postApiDatasetImports`

Create a dataset from an uploaded file

Permission `datasets:create`. Declared at `src/transport/dataset.rest.ts:247`.

Answers at `/api/dataset/imports`, `/api/v1/dataset/imports`; also, undocumented, `/api/dataset/2026-08-07/imports`, `/api/v1/dataset/2026-08-07/imports`, `/api/dataset/latest/imports`, `/api/v1/dataset/latest/imports`.

```typescript
type Body = z.infer<typeof datasetRestImportSchema>; // ../contract/src/dataset-rest.schemas.ts:90
// Response: datasetImportStartedSchema, ../contract/src/dataset.ts:406
interface Response {
  datasetId: string;
  slug: string;
  status: "processing";
}
```

#### `POST /:slugOrId/imports` · `postApiDatasetBySlugOrIdImports`

Import an uploaded file into a dataset

Permission `datasets:update`. Declared at `src/transport/dataset.rest.ts:260`.

Answers at `/api/dataset/:slugOrId/imports`, `/api/v1/dataset/:slugOrId/imports`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId/imports`, `/api/v1/dataset/2026-08-07/:slugOrId/imports`, `/api/dataset/latest/:slugOrId/imports`, `/api/v1/dataset/latest/:slugOrId/imports`.

```typescript
type Params = z.infer<typeof datasetRestSlugOrIdParamsSchema>; // ../contract/src/dataset-rest.schemas.ts:75
// Body: datasetRestAppendImportSchema, ../contract/src/dataset-rest.schemas.ts:95
type Body = BodyDatasetAppendImport;
type BodyDatasetAppendImport = {
  storedObjectId: string;
};
// Response: datasetImportAppendedSchema, ../contract/src/dataset.ts:423
interface Response {
  datasetId: string;
  recordsCreated: number;
}
```

#### `POST /upload` · `postApiDatasetUpload`

Create a new dataset from an uploaded file (CSV, JSON, JSONL)

Permission `datasets:create`. Deprecated. Declared at `src/transport/dataset.rest.ts:275`.

Answers at `/api/dataset/upload`, `/api/v1/dataset/upload`; also, undocumented, `/api/dataset/2026-08-07/upload`, `/api/v1/dataset/2026-08-07/upload`, `/api/dataset/latest/upload`, `/api/v1/dataset/latest/upload`.

```typescript
// Multipart: { fields: datasetRestUploadFieldsSchema, files: { file: { required: true } } } (inline, src/transport/dataset.rest.ts:276)
type Response = z.infer<typeof datasetRestUploadCreatedSchema>; // ../contract/src/dataset-rest.schemas.ts:124
```

#### `POST /:slugOrId/upload` · `postApiDatasetBySlugOrIdUpload`

Upload a file (CSV, JSON, JSONL) to an existing dataset

Permission `datasets:update`. Deprecated. Declared at `src/transport/dataset.rest.ts:293`.

Answers at `/api/dataset/:slugOrId/upload`, `/api/v1/dataset/:slugOrId/upload`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId/upload`, `/api/v1/dataset/2026-08-07/:slugOrId/upload`, `/api/dataset/latest/:slugOrId/upload`, `/api/v1/dataset/latest/:slugOrId/upload`.

```typescript
type Params = z.infer<typeof datasetRestSlugOrIdParamsSchema>; // ../contract/src/dataset-rest.schemas.ts:75
// Multipart: { fields: datasetRestNoUploadFieldsSchema, files: { file: { required: true } }, } (inline, src/transport/dataset.rest.ts:295)
type Response = z.infer<typeof datasetImportAppendedSchema>; // ../contract/src/dataset.ts:423
```

#### `POST /attachments` · `postApiDatasetAttachments`

Upload a file for an image or file column and get the reference a cell holds. The project is named by the `projectId` query parameter; the file goes in the `file` multipart field, with an optional `datasetId` field.

Permission `datasets:manage`. Deprecated. Declared at `src/transport/dataset.rest.ts:316`.

Answers at `/api/dataset/attachments`, `/api/v1/dataset/attachments`; also, undocumented, `/api/dataset/2026-08-07/attachments`, `/api/v1/dataset/2026-08-07/attachments`, `/api/dataset/latest/attachments`, `/api/v1/dataset/latest/attachments`.

```typescript
// Query: datasetRestAttachmentQuerySchema, ../contract/src/dataset-rest.schemas.ts:105
interface Query {
  projectId: string;
}
// Multipart: { fields: datasetRestAttachmentFieldsSchema, files: { file: { required: true } }, } (inline, src/transport/dataset.rest.ts:318)
// Response: storedDatasetAttachmentSchema, ../contract/src/dataset.ts:350
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

Permission `datasets:update`. Declared at `src/transport/dataset.rest.ts:357`.

Answers at `/api/dataset/attachments/uploads`, `/api/v1/dataset/attachments/uploads`; also, undocumented, `/api/dataset/2026-08-07/attachments/uploads`, `/api/v1/dataset/2026-08-07/attachments/uploads`, `/api/dataset/latest/attachments/uploads`, `/api/v1/dataset/latest/attachments/uploads`.

```typescript
// Body: datasetRestAttachmentUploadSchema, ../contract/src/dataset-rest.schemas.ts:117
interface Body {
  filename: string;
  mediaType: string;
  byteLength: number;
}
// Response: datasetAttachmentUploadSchema, ../contract/src/dataset.ts:376
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

Permission `datasets:view`. Declared at `src/transport/dataset.rest.ts:377`.

Answers at `/api/dataset/:slugOrId`, `/api/v1/dataset/:slugOrId`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId`, `/api/v1/dataset/2026-08-07/:slugOrId`, `/api/dataset/latest/:slugOrId`, `/api/v1/dataset/latest/:slugOrId`.

```typescript
type Params = z.infer<typeof datasetRestSlugOrIdParamsSchema>; // ../contract/src/dataset-rest.schemas.ts:75
type Response = z.infer<typeof datasetRestDetailResponseSchema>; // ../contract/src/dataset-rest.schemas.ts:154
```

#### `PATCH /:slugOrId` · `patchApiDatasetBySlugOrId`

Update a dataset by its slug or id

Permission `datasets:manage`. Declared at `src/transport/dataset.rest.ts:407`.

Answers at `/api/dataset/:slugOrId`, `/api/v1/dataset/:slugOrId`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId`, `/api/v1/dataset/2026-08-07/:slugOrId`, `/api/dataset/latest/:slugOrId`, `/api/v1/dataset/latest/:slugOrId`.

```typescript
type Params = z.infer<typeof datasetRestSlugOrIdParamsSchema>; // ../contract/src/dataset-rest.schemas.ts:75
type Body = z.infer<typeof datasetRestUpdateSchema>; // ../contract/src/dataset-rest.schemas.ts:38
type Response = z.infer<typeof datasetRestSummarySchema>; // ../contract/src/dataset-rest.schemas.ts:135
```

#### `DELETE /:slugOrId` · `deleteApiDatasetBySlugOrId`

Archive a dataset (soft-delete)

Permission `datasets:manage`. Declared at `src/transport/dataset.rest.ts:438`.

Answers at `/api/dataset/:slugOrId`, `/api/v1/dataset/:slugOrId`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId`, `/api/v1/dataset/2026-08-07/:slugOrId`, `/api/dataset/latest/:slugOrId`, `/api/v1/dataset/latest/:slugOrId`.

```typescript
type Params = z.infer<typeof datasetRestSlugOrIdParamsSchema>; // ../contract/src/dataset-rest.schemas.ts:75
// Response: datasetRestArchivedSchema, ../contract/src/dataset-rest.schemas.ts:176
interface Response {
  id: string;
  archived: true;
}
```

#### `GET /:slugOrId/records` · `getApiDatasetBySlugOrIdRecords`

List records for a dataset (paginated). Each page also carries the dataset itself. A page too large for one response is refused with `dataset_page_too_large`: ask again with the smaller `limit` the error names.

Permission `datasets:view`. Declared at `src/transport/dataset.rest.ts:447`.

Answers at `/api/dataset/:slugOrId/records`, `/api/v1/dataset/:slugOrId/records`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId/records`, `/api/v1/dataset/2026-08-07/:slugOrId/records`, `/api/dataset/latest/:slugOrId/records`, `/api/v1/dataset/latest/:slugOrId/records`.

```typescript
type Params = z.infer<typeof datasetRestSlugOrIdParamsSchema>; // ../contract/src/dataset-rest.schemas.ts:75
type Query = z.infer<typeof datasetRestPaginationQuerySchema>; // ../contract/src/dataset-rest.schemas.ts:43
type Response = z.infer<typeof datasetRestRecordPageSchema>; // ../contract/src/dataset-rest.schemas.ts:168
```

#### `GET /:datasetSlug/entries` · `getApiDatasetBySlugEntries`

List entries of a dataset (paginated). Same as GET /:slugOrId/records.

Permission `datasets:view`. Declared at `src/transport/dataset.rest.ts:472`.

Answers at `/api/dataset/:datasetSlug/entries`, `/api/v1/dataset/:datasetSlug/entries`; also, undocumented, `/api/dataset/2026-08-07/:datasetSlug/entries`, `/api/v1/dataset/2026-08-07/:datasetSlug/entries`, `/api/dataset/latest/:datasetSlug/entries`, `/api/v1/dataset/latest/:datasetSlug/entries`.

```typescript
type Params = z.infer<typeof datasetRestSlugParamsSchema>; // ../contract/src/dataset-rest.schemas.ts:76
type Query = z.infer<typeof datasetRestPaginationQuerySchema>; // ../contract/src/dataset-rest.schemas.ts:43
type Response = z.infer<typeof datasetRestRecordPageSchema>; // ../contract/src/dataset-rest.schemas.ts:168
```

#### `PATCH /:slugOrId/records/:recordId` · `patchApiDatasetBySlugOrIdRecordsByRecordId`

Update or create a record in a dataset

Permission `datasets:update`. Declared at `src/transport/dataset.rest.ts:495`.

Answers at `/api/dataset/:slugOrId/records/:recordId`, `/api/v1/dataset/:slugOrId/records/:recordId`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId/records/:recordId`, `/api/v1/dataset/2026-08-07/:slugOrId/records/:recordId`, `/api/dataset/latest/:slugOrId/records/:recordId`, `/api/v1/dataset/latest/:slugOrId/records/:recordId`.

```typescript
// Params: datasetRestRecordParamsSchema, ../contract/src/dataset-rest.schemas.ts:79
interface Params {
  slugOrId: string;
  recordId: string;
}
// Body: datasetRestUpdateRecordSchema, ../contract/src/dataset-rest.schemas.ts:85
interface Body {
  entry: Record<string, unknown>;
}
```

#### `DELETE /:slugOrId/records` · `deleteApiDatasetBySlugOrIdRecords`

Delete records from a dataset by IDs

Permission `datasets:manage`. Declared at `src/transport/dataset.rest.ts:513`.

Answers at `/api/dataset/:slugOrId/records`, `/api/v1/dataset/:slugOrId/records`; also, undocumented, `/api/dataset/2026-08-07/:slugOrId/records`, `/api/v1/dataset/2026-08-07/:slugOrId/records`, `/api/dataset/latest/:slugOrId/records`, `/api/v1/dataset/latest/:slugOrId/records`.

```typescript
type Params = z.infer<typeof datasetRestSlugOrIdParamsSchema>; // ../contract/src/dataset-rest.schemas.ts:75
// Body: datasetRestDeleteRecordsSchema, ../contract/src/dataset-rest.schemas.ts:55
interface Body {
  recordIds: string[];
}
// Response: datasetRestRecordsDeletedSchema, ../contract/src/dataset-rest.schemas.ts:182
interface Response {
  deletedCount: number;
}
```

## tRPC transport

### `datasetRecord`

Contract `../contract/src/dataset-record.trpc.ts:27`, router `src/transport/dataset-record.trpc.ts:13`.

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
// Input: datasetRecordApiCreateInputSchema, ../contract/src/dataset.schemas.ts:88
interface Input {
  projectId: string;
  datasetId: string;
  entries: (Record<string, unknown> & {
    id: string;
  })[];
}
// Output: inline, ../contract/src/dataset-record.trpc.ts:31
type Output = {
  id: string;
  datasetId: string;
  projectId: string;
  entry: Record<string, unknown>;
  createdAt: unknown;
  updatedAt: unknown;
}[];

// datasetRecord.update
// Input: datasetRecordApiUpdateInputSchema, ../contract/src/dataset.schemas.ts:95
interface Input {
  projectId: string;
  datasetId: string;
  recordId: string;
  updatedRecord: Record<string, unknown>;
}
// Output: datasetRecordMutationResultSchema, ../contract/src/dataset.ts:215
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
// Input: datasetRecordApiLookupInputSchema, ../contract/src/dataset.schemas.ts:103
interface Input {
  projectId: string;
  datasetId: string;
}
type Output = z.infer<typeof datasetRecordEditorReadSchema>; // ../contract/src/dataset.responses.ts:13

// datasetRecord.listPaginated
// Input: datasetRecordApiPageInputSchema, ../contract/src/dataset.schemas.ts:109
interface Input {
  projectId: string;
  datasetId: string;
  page?: number;
  limit?: number;
  search?: string;
}
// Output: datasetPageSchema.nullable() (inline, ../contract/src/dataset-record.trpc.ts:46)

// datasetRecord.download
type Input = z.infer<typeof datasetRecordApiLookupInputSchema>; // ../contract/src/dataset.schemas.ts:103
type Output = z.infer<typeof datasetRecordEditorReadSchema>; // ../contract/src/dataset.responses.ts:13

// datasetRecord.getHead
type Input = z.infer<typeof datasetRecordApiLookupInputSchema>; // ../contract/src/dataset.schemas.ts:103
type Output = z.infer<typeof datasetRecordHeadReadSchema>; // ../contract/src/dataset.responses.ts:24

// datasetRecord.deleteMany
// Input: datasetRecordApiDeleteManyInputSchema, ../contract/src/dataset.schemas.ts:118
interface Input {
  projectId: string;
  datasetId: string;
  recordIds: string[];
}
// Output: datasetRecordsDeletedSchema, ../contract/src/dataset-record.trpc.ts:25
interface Output {
  count: number;
}
```

### `dataset`

Contract `../contract/src/dataset.trpc.ts:39`, router `src/transport/dataset.trpc.ts:11`.

| Procedure                        | Kind     | Gate                         | Input                                      | Output                          |
| -------------------------------- | -------- | ---------------------------- | ------------------------------------------ | ------------------------------- |
| `dataset.upsert`                 | mutation | Permission `datasets:manage` | inline                                     | `datasetWireSchema`             |
| `dataset.validateDatasetName`    | query    | Permission `datasets:view`   | `datasetApiValidateNameInputSchema`        | `datasetNameResultSchema`       |
| `dataset.getAll`                 | query    | Permission `datasets:view`   | `datasetApiProjectInputSchema`             | inline                          |
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
// Input: datasetApiUpsertBaseInputSchema.and(datasetApiUpsertTargetInputSchema) (inline, ../contract/src/dataset.trpc.ts:42)
type Output = z.infer<typeof datasetWireSchema>; // ../contract/src/dataset.ts:132

// dataset.validateDatasetName
// Input: datasetApiValidateNameInputSchema, ../contract/src/dataset.schemas.ts:39
interface Input {
  projectId: string;
  proposedName: string;
  excludeDatasetId?: string;
}
// Output: datasetNameResultSchema, ../contract/src/dataset.ts:241
interface Output {
  available: boolean;
  slug: string;
  conflictsWith?: string;
}

// dataset.getAll
// Input: datasetApiProjectInputSchema, ../contract/src/dataset.schemas.ts:46
interface Input {
  projectId: string;
}
// Output: z.array(datasetSummaryWireSchema) (inline, ../contract/src/dataset.trpc.ts:53)

// dataset.getById
// Input: datasetApiDatasetInputSchema, ../contract/src/dataset.schemas.ts:49
interface Input {
  projectId: string;
  datasetId: string;
}
// Output: datasetWireSchema.nullable() (inline, ../contract/src/dataset.trpc.ts:58)

// dataset.deleteById
// Input: datasetApiDeleteInputSchema, ../contract/src/dataset.schemas.ts:54
interface Input {
  projectId: string;
  datasetId: string;
  undo?: boolean;
}
// Output: datasetDeletedSchema, ../contract/src/dataset.trpc.ts:37
interface Output {
  success: true;
}

// dataset.updateMapping
// Input: datasetApiUpdateMappingInputSchema, ../contract/src/dataset.schemas.ts:60
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
type Output = z.infer<typeof datasetWireSchema>; // ../contract/src/dataset.ts:132

// dataset.findNextName
// Input: datasetApiFindNextNameInputSchema, ../contract/src/dataset.schemas.ts:76
interface Input {
  projectId: string;
  proposedName: string;
}
// Output: inline, ../contract/src/dataset.trpc.ts:73
type Output = string;

// dataset.copy
// Input: datasetApiCopyInputSchema, ../contract/src/dataset.schemas.ts:81
interface Input {
  datasetId: string;
  sourceProjectId: string;
  projectId: string;
}
type Output = z.infer<typeof datasetWireSchema>; // ../contract/src/dataset.ts:132

// dataset.createFromStoredObject
type Input = z.infer<typeof createDatasetFromStoredObjectInputSchema>; // ../contract/src/dataset.ts:396
type Output = z.infer<typeof datasetImportStartedSchema>; // ../contract/src/dataset.ts:406

// dataset.appendStoredObject
// Input: appendStoredObjectToDatasetInputSchema, ../contract/src/dataset.ts:414
interface Input {
  projectId: string;
  slugOrId: string;
  storedObjectId: string;
}
type Output = z.infer<typeof datasetImportAppendedSchema>; // ../contract/src/dataset.ts:423

// dataset.getLimits
type Input = z.infer<typeof datasetApiProjectInputSchema>; // ../contract/src/dataset.schemas.ts:46
// Output: datasetLimitsSchema, ../contract/src/dataset-limits.ts:13
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
// Input: createDatasetAttachmentUploadInputSchema, ../contract/src/dataset.ts:363
interface Input {
  projectId: string;
  filename: string;
  mediaType: string;
  byteLength: number;
}
type Output = z.infer<typeof datasetAttachmentUploadSchema>; // ../contract/src/dataset.ts:376

// dataset.retryNormalize
// Input: retryNormalizeInputSchema, ../contract/src/dataset.ts:436
interface Input {
  projectId: string;
  datasetId: string;
}
// Output: uploadProcessingSchema, ../contract/src/dataset.ts:429
interface Output {
  datasetId: string;
  status: "processing";
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `dataset_normalization` (aggregate `dataset`)

Declared at `src/eventing/dataset-normalization.pipeline.ts:27`.

| Kind    | Name | Handles | Declared at                                         |
| ------- | ---- | ------- | --------------------------------------------------- |
| command | –    | –       | `src/eventing/dataset-normalization.pipeline.ts:32` |

### Tasks

Run by the tasks process, before serve.

| Task                       | Class                        | Declared at                                     |
| -------------------------- | ---------------------------- | ----------------------------------------------- |
| `dataset-content-backfill` | `DatasetContentBackfillTask` | `src/tasks/dataset-content-backfill.task.ts:48` |

## Configuration

| Kind   | Leaf            | Environment variable | Declared at                           |
| ------ | --------------- | -------------------- | ------------------------------------- |
| config | `publicBaseUrl` | `BASE_HOST`          | `../contract/src/dataset.config.ts:5` |

<!-- readme:generated:end -->
