import { moduleApi } from "@langwatch/kernel/module-api";

import type { BatchEvaluationRecord, BatchEvaluationSummary } from "./batch-record.trpc.ts";
import type {
  AppendStoredObjectToDatasetInput,
  CopyDatasetInput,
  CreateDatasetFromStoredObjectInput,
  CreateDatasetFromUploadInput,
  CreateDatasetFromUploadResult,
  CreateDatasetRecordsInput,
  Dataset,
  DatasetColumns,
  DatasetEntrySelection,
  DatasetHead,
  DatasetImportAppended,
  DatasetImportStarted,
  DatasetListResult,
  DatasetLookupInput,
  DatasetNameInput,
  DatasetNameResult,
  DatasetPage,
  DatasetPageInput,
  DatasetRecord,
  DatasetRecordMutationResult,
  DatasetRecordPage,
  DatasetWithRecords,
  DeleteDatasetRecordsInput,
  ListDatasetsInput,
  RetryNormalizeInput,
  StoreDatasetAttachmentUploadInput,
  StoredDatasetAttachment,
  UploadProcessing,
  UpdateDatasetRecordInput,
  UploadExistingDatasetInput,
  UpsertDatasetInput,
} from "./dataset.ts";

/**
 * What the install-wide usage report counts here (ADR-156, section 10): how
 * many were made, since `since` where one is given, and when the first was.
 * Times are epoch milliseconds; a first is absent where none exists.
 */
export interface DatasetUsageCount {
  readonly datasets: number;
  readonly datasetRecords: number;
  readonly batchEvaluations: number;
  readonly firstDatasetAt?: number;
  readonly firstBatchEvaluationAt?: number;
}

/** Callable capability exposed by the composed Dataset application. */
export interface DatasetApi {
  upsertDataset: (input: {
    projectId: string;
    datasetId?: string;
    slugOrId?: string;
    experimentId?: string;
    name?: string;
    columnTypes?: DatasetColumns;
    datasetRecords?: UpsertDatasetInput["datasetRecords"];
  }) => Promise<Dataset>;
  validateDatasetName(input: DatasetNameInput): Promise<DatasetNameResult>;
  findNextAvailableName(input: DatasetNameInput): Promise<string>;
  listDatasets: (input: ListDatasetsInput) => Promise<DatasetListResult>;
  getBySlugOrId(input: DatasetLookupInput): Promise<Dataset>;
  findBySlugOrId(input: DatasetLookupInput): Promise<Dataset | null>;
  updateMapping(input: {
    datasetId: string;
    projectId: string;
    mapping?: { mapping: Record<string, unknown>; expansions: string[] };
    threadMapping?: { mapping: Record<string, unknown> };
  }): Promise<Dataset>;
  archiveDataset: (input: DatasetLookupInput) => Promise<{ id: string; archived: true }>;
  restoreDataset(input: { datasetId: string; projectId: string }): Promise<{ success: true }>;
  copyDataset(input: CopyDatasetInput): Promise<Dataset>;
  /**
   * The same copy, on behalf of a person: the caller's reach into the SOURCE
   * project is probed before anything is read from it, which a door's declared
   * check — made against the target — never covers.
   */
  copyDatasetForActor(input: CopyDatasetInput & { actorId: string }): Promise<Dataset>;
  getDatasetWithRecords: (
    input: DatasetLookupInput & {
      limitMb?: number | null;
      entrySelection?: DatasetEntrySelection;
    },
  ) => Promise<DatasetWithRecords>;
  getDatasetPage(input: DatasetPageInput): Promise<DatasetPage>;
  findDatasetPage(input: DatasetPageInput): Promise<DatasetPage | null>;
  getDatasetHead(input: DatasetLookupInput): Promise<DatasetHead>;
  listRecords: (input: DatasetPageInput) => Promise<DatasetRecordPage>;
  batchCreateRecords: (input: CreateDatasetRecordsInput) => Promise<DatasetRecord[]>;
  upsertRecord(
    input: UpdateDatasetRecordInput & { recordId: string },
  ): Promise<DatasetRecordMutationResult>;
  deleteRecords: (input: DeleteDatasetRecordsInput) => Promise<{ count: number }>;
  /** Deprecated with the multipart upload routes; retires in the next release (ADR-158 §8). */
  createDatasetFromUpload(
    input: CreateDatasetFromUploadInput,
  ): Promise<CreateDatasetFromUploadResult>;
  /** Deprecated with the multipart upload routes; retires in the next release (ADR-158 §8). */
  uploadToExistingDataset(
    input: UploadExistingDatasetInput,
  ): Promise<{ datasetId: string; recordsCreated: number }>;
  createDatasetFromStoredObject(
    input: CreateDatasetFromStoredObjectInput,
  ): Promise<DatasetImportStarted>;
  /** Deprecated with `POST /api/dataset/attachments`; retires in the next release (ADR-158 §8). */
  storeAttachmentUpload(input: StoreDatasetAttachmentUploadInput): Promise<StoredDatasetAttachment>;
  appendStoredObjectToDataset(
    input: AppendStoredObjectToDatasetInput,
  ): Promise<DatasetImportAppended>;
  retryNormalize(input: RetryNormalizeInput): Promise<UploadProcessing>;
  getByIds(input: { projectId: string; datasetIds: string[] }): Promise<Dataset[]>;
  renameDataset(input: { datasetId: string; projectId: string; name: string }): Promise<Dataset>;
  /** One row per experiment and dataset: how many ran, total cost, mean score. */
  summariseBatchEvaluations(input: { projectId: string }): Promise<BatchEvaluationSummary[]>;
  /** Every batch-evaluation record of the experiment the slug names. */
  listBatchEvaluations(input: {
    projectId: string;
    experimentSlug: string;
  }): Promise<BatchEvaluationRecord[]>;
  /**
   * The platform's own address for one dataset resource, built from the
   * project's slug and a caller-resolved path. The REST declaration is
   * static with no request-scoped builder, so the app composes this link.
   */
  platformUrl(input: { projectSlug: string; path: string }): string;
  /** The usage report's figures for these projects. */
  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<DatasetUsageCount>;
}

export const DatasetApi = moduleApi<DatasetApi>()("dataset");
