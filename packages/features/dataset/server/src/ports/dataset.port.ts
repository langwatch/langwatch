import type {
  AbortPendingUploadInput,
  CreateDatasetFromUploadInput,
  CreateDatasetFromUploadResult,
  FinalizeUploadInput,
  PendingUploadInput,
  PendingUploadResult,
  RetryNormalizeInput,
  StagedUploadInput,
  UploadExistingDatasetInput,
} from "@langwatch/dataset-contract";
import type {
  Dataset,
  DatasetHead,
  DatasetPage,
  DatasetPageInput,
  DatasetRecord,
  DatasetRecordMutationResult,
  DatasetRecordPage,
  DatasetWithRecords,
  DatasetEntrySelection,
  DeleteDatasetRecordsInput,
  CreateDatasetRecordsInput,
  UpdateDatasetRecordInput,
} from "@langwatch/dataset-contract";

/**
 * Upload and object-storage behavior is a Dataset capability, but its concrete
 * provider is selected by the application composition root. Keeping this port
 * separate prevents the core Dataset service from importing S3, queues, or
 * process globals.
 */
/**
 * A dataset row as its storage returns it.
 *
 * The scalar columns only — deliberately not the parsed `Dataset` the contract
 * publishes, because the upload path reads `columnTypes` raw in some places and
 * parses it in others, and moving that parse into the repository would newly
 * throw on the retry and cancel paths for a row those paths never look inside.
 * This states the shape without changing when anything is validated.
 */
export type DatasetRow = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  columnTypes: unknown;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  mapping: unknown;
  useS3: boolean;
  s3RecordCount: number | null;
  contentLayout: string;
  status: string;
  statusError: string | null;
  stagingKey: string | null;
  uploadFilename: string | null;
  rowCount: number | null;
  sizeBytes: bigint | null;
  chunkCount: number | null;
  chunkOffsets: unknown;
};

export abstract class DatasetUploadPort {
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

/** Durable queue seam used by normalize/finalize work. */
export abstract class DatasetNormalizeQueuePort {
  abstract enqueueNormalize(input: { datasetId: string; projectId: string }): Promise<void>;
}

/**
 * Content-layout operations that cannot be served by the relational record
 * repositories.  The Dataset service chooses this port only for
 * `contentLayout: "s3_jsonl"`; the application supplies the concrete object
 * storage implementation at process composition time.  Keeping this seam
 * explicit is important: routes must never decide whether a dataset is in
 * Postgres or object storage, and the service must not reach for a provider
 * or a process-global database client.
 */
export abstract class DatasetContentPort {
  abstract listRecords(input: {
    dataset: Dataset;
    input: DatasetPageInput;
  }): Promise<DatasetRecordPage>;
  abstract getDatasetPage(input: {
    dataset: Dataset;
    input: DatasetPageInput;
  }): Promise<DatasetPage>;
  abstract getDatasetWithRecords(input: {
    dataset: Dataset;
    projectId: string;
    entrySelection: DatasetEntrySelection;
    limitMb: number | null;
  }): Promise<DatasetWithRecords>;
  abstract getDatasetHead(input: { dataset: Dataset }): Promise<DatasetHead>;
  abstract upsertRecord(input: {
    dataset: Dataset;
    input: UpdateDatasetRecordInput & { recordId: string };
  }): Promise<DatasetRecordMutationResult>;
  abstract batchCreateRecords(input: {
    dataset: Dataset;
    input: CreateDatasetRecordsInput;
  }): Promise<DatasetRecord[]>;
  abstract deleteRecords(input: {
    dataset: Dataset;
    input: DeleteDatasetRecordsInput;
  }): Promise<{ count: number }>;
  abstract copyDataset(input: {
    source: Dataset;
    sourceProjectId: string;
    target: Dataset;
    targetProjectId: string;
  }): Promise<void>;
  abstract updateColumns(input: {
    dataset: Dataset;
    projectId: string;
    name: string;
    slug: string;
    columnTypes: Dataset["columnTypes"];
  }): Promise<Dataset>;
}
