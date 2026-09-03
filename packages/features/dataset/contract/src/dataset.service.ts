import type {
  CopyDatasetInput,
  CreateDatasetFromUploadInput,
  CreateDatasetFromUploadResult,
  CreateDatasetRecordsInput,
  Dataset,
  DatasetLookupInput,
  DatasetNameInput,
  DatasetNameResult,
  DatasetPage,
  DatasetPageInput,
  DatasetListResult,
  DatasetHead,
  DatasetRecordPage,
  DatasetRecordMutationResult,
  DatasetRecord,
  DatasetWithRecords,
  DatasetEntrySelection,
  DeleteDatasetRecordsInput,
  ListDatasetsInput,
  UpdateDatasetRecordInput,
  UploadExistingDatasetInput,
  PendingUploadInput,
  PendingUploadResult,
  StagedUploadInput,
  AbortPendingUploadInput,
  FinalizeUploadInput,
  RetryNormalizeInput,
  UpsertDatasetInput,
} from "./dataset";

export abstract class DatasetService {
  abstract upsertDataset(input: UpsertDatasetInput): Promise<Dataset>;
  abstract validateDatasetName(input: DatasetNameInput): Promise<DatasetNameResult>;
  abstract findNextAvailableName(input: DatasetNameInput): Promise<string>;
  abstract getBySlugOrId(input: DatasetLookupInput): Promise<Dataset>;
  abstract getByIds(input: { projectId: string; datasetIds: string[] }): Promise<Dataset[]>;
  abstract renameDataset(input: {
    datasetId: string;
    projectId: string;
    name: string;
  }): Promise<Dataset>;
  abstract listDatasets(input: ListDatasetsInput): Promise<DatasetListResult>;
  abstract archiveDataset(input: DatasetLookupInput): Promise<{ id: string; archived: true }>;
  abstract restoreDataset(input: {
    datasetId: string;
    projectId: string;
  }): Promise<{ success: true }>;
  abstract updateMapping(input: {
    datasetId: string;
    projectId: string;
    mapping?: { mapping: Record<string, unknown>; expansions: string[] };
    threadMapping?: { mapping: Record<string, unknown> };
  }): Promise<Dataset>;
  abstract listRecords(input: DatasetPageInput): Promise<DatasetRecordPage>;
  abstract getDatasetPage(input: DatasetPageInput): Promise<DatasetPage>;
  abstract getDatasetWithRecords(
    input: DatasetLookupInput & {
      limitMb?: number | null;
      entrySelection?: DatasetEntrySelection;
    },
  ): Promise<DatasetWithRecords>;
  abstract getDatasetHead(input: DatasetLookupInput): Promise<DatasetHead>;
  abstract upsertRecord(
    input: UpdateDatasetRecordInput & { recordId: string },
  ): Promise<DatasetRecordMutationResult>;
  abstract batchCreateRecords(input: CreateDatasetRecordsInput): Promise<DatasetRecord[]>;
  abstract deleteRecords(input: DeleteDatasetRecordsInput): Promise<{ count: number }>;
  abstract copyDataset(input: CopyDatasetInput): Promise<Dataset>;
  abstract uploadToExistingDataset(
    input: UploadExistingDatasetInput,
  ): Promise<{ datasetId: string; recordsCreated: number }>;
  abstract createDatasetFromUpload(
    input: CreateDatasetFromUploadInput,
  ): Promise<CreateDatasetFromUploadResult>;
  abstract createPendingUpload(input: PendingUploadInput): Promise<PendingUploadResult>;
  abstract writeStagedUpload(input: StagedUploadInput): Promise<void>;
  abstract abortPendingUpload(
    input: AbortPendingUploadInput,
  ): Promise<{ datasetId: string; aborted: true }>;
  abstract finalizeUpload(
    input: FinalizeUploadInput,
  ): Promise<{ datasetId: string; status: "processing" }>;
  abstract retryNormalize(
    input: RetryNormalizeInput,
  ): Promise<{ datasetId: string; status: "processing" }>;
}
