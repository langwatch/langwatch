import { featureApi } from "@langwatch/runtime-composition";
import type {
  AbortPendingUploadInput,
  CopyDatasetInput,
  CreateDatasetFromUploadInput,
  CreateDatasetFromUploadResult,
  CreateDatasetRecordsInput,
  Dataset,
  DatasetColumns,
  DatasetEntrySelection,
  DatasetHead,
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
  FinalizeUploadInput,
  ListDatasetsInput,
  PendingUploadInput,
  PendingUploadResult,
  RetryNormalizeInput,
  StagedUploadInput,
  UpdateDatasetRecordInput,
  UploadExistingDatasetInput,
  UpsertDatasetInput,
} from "./dataset.ts";
import type {
  BatchEvaluationRecord,
  BatchEvaluationSummary,
} from "./batch-record.trpc.ts";

/** Callable capability exposed by the composed Dataset application. */
export interface DatasetApi {
  upsertDataset(input: {
    projectId: string;
    datasetId?: string;
    slugOrId?: string;
    experimentId?: string;
    name?: string;
    columnTypes?: DatasetColumns;
    datasetRecords?: UpsertDatasetInput["datasetRecords"];
  }): Promise<Dataset>;
  validateDatasetName(input: DatasetNameInput): Promise<DatasetNameResult>;
  findNextAvailableName(input: DatasetNameInput): Promise<string>;
  listDatasets(input: ListDatasetsInput): Promise<DatasetListResult>;
  getBySlugOrId(input: DatasetLookupInput): Promise<Dataset>;
  updateMapping(input: {
    datasetId: string;
    projectId: string;
    mapping?: { mapping: Record<string, unknown>; expansions: string[] };
    threadMapping?: { mapping: Record<string, unknown> };
  }): Promise<Dataset>;
  archiveDataset(input: DatasetLookupInput): Promise<{ id: string; archived: true }>;
  restoreDataset(input: { datasetId: string; projectId: string }): Promise<{ success: true }>;
  copyDataset(input: CopyDatasetInput): Promise<Dataset>;
  /**
   * The same copy, on behalf of a person: the caller's reach into the SOURCE
   * project is probed before anything is read from it, which a door's declared
   * check — made against the target — never covers.
   */
  copyDatasetForActor(input: CopyDatasetInput & { actorId: string }): Promise<Dataset>;
  getDatasetWithRecords(
    input: DatasetLookupInput & {
      limitMb?: number | null;
      entrySelection?: DatasetEntrySelection;
    },
  ): Promise<DatasetWithRecords>;
  getDatasetPage(input: DatasetPageInput): Promise<DatasetPage>;
  getDatasetHead(input: DatasetLookupInput): Promise<DatasetHead>;
  listRecords(input: DatasetPageInput): Promise<DatasetRecordPage>;
  batchCreateRecords(input: CreateDatasetRecordsInput): Promise<DatasetRecord[]>;
  upsertRecord(input: UpdateDatasetRecordInput & { recordId: string }): Promise<DatasetRecordMutationResult>;
  deleteRecords(input: DeleteDatasetRecordsInput): Promise<{ count: number }>;
  createDatasetFromUpload(input: CreateDatasetFromUploadInput): Promise<CreateDatasetFromUploadResult>;
  uploadToExistingDataset(input: UploadExistingDatasetInput): Promise<{ datasetId: string; recordsCreated: number }>;
  createPendingUpload(input: PendingUploadInput): Promise<PendingUploadResult>;
  writeStagedUpload(input: StagedUploadInput): Promise<void>;
  finalizeUpload(input: FinalizeUploadInput): Promise<{ datasetId: string; status: "processing" }>;
  retryNormalize(input: RetryNormalizeInput): Promise<{ datasetId: string; status: "processing" }>;
  abortPendingUpload(input: AbortPendingUploadInput): Promise<{ datasetId: string; aborted: true }>;
  getByIds(input: { projectId: string; datasetIds: string[] }): Promise<Dataset[]>;
  renameDataset(input: { datasetId: string; projectId: string; name: string }): Promise<Dataset>;
  /** One row per experiment and dataset: how many ran, total cost, mean score. */
  summariseBatchEvaluations(input: {
    projectId: string;
  }): Promise<BatchEvaluationSummary[]>;
  /** Every batch-evaluation record of the experiment the slug names. */
  listBatchEvaluations(input: {
    projectId: string;
    experimentSlug: string;
  }): Promise<BatchEvaluationRecord[]>;
}

export const DatasetApi = featureApi<DatasetApi>("dataset");
