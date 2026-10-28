import { moduleApi } from "@langwatch/module";
import type { StoredObjectsCreateUploadOutput } from "@langwatch/stored-object-contract";

import type { BatchEvaluationRecord, BatchEvaluationSummary } from "./batch-evaluation.schemas.ts";
import type { DatasetLimits } from "./dataset-limits.ts";
import type {
  CompareDatasetVersionInput,
  DatasetVersion,
  DatasetVersionHistory,
  DatasetVersionAuthor,
  DatasetVersionComparison,
  DatasetVersionContent,
  DatasetVersionLookupInput,
  DatasetVersionPage,
  DatasetVersionPageInput,
  DatasetVersionRestored,
  DatasetVersionRunLink,
  FindRunDatasetVersionsInput,
  ListDatasetVersionsInput,
  SaveDatasetVersionInput,
} from "./dataset-version.ts";
import type { DatasetApiDeleteInput } from "./dataset.schemas.ts";
import type {
  AppendStoredObjectToDatasetInput,
  CopyDatasetInput,
  CountDatasetRecordsInput,
  CreateDatasetAttachmentUploadInput,
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
  DatasetRecordCount,
  DatasetSummary,
  DatasetRecordMutationResult,
  DatasetRecordPage,
  DatasetStorageEntry,
  DatasetStoragePageInput,
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

/** Who made a change, when the transport could tell; the autosave names them as its author. */
export type EditedBy = { editedBy?: DatasetVersionAuthor };

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

/** One batch-evaluation row a dataset evaluation writes against the dataset it ran over. */
export type BatchEvaluationEntry = Readonly<{
  id: string;
  experimentId: string;
  projectId: string;
  data: Record<string, unknown>;
  status: string;
  score: number;
  passed: boolean;
  label: string | null;
  details: string;
  cost: number;
  evaluation: string;
  datasetSlug: string;
  datasetId: string;
}>;

/** Callable capability exposed by the composed Dataset application. */
export interface DatasetApi {
  upsertDataset: (
    input: {
      projectId: string;
      datasetId?: string;
      slugOrId?: string;
      name?: string;
      columnTypes?: DatasetColumns;
      datasetRecords?: UpsertDatasetInput["datasetRecords"];
    } & EditedBy,
  ) => Promise<Dataset>;
  validateDatasetName(input: DatasetNameInput): Promise<DatasetNameResult>;
  findNextAvailableName(input: DatasetNameInput): Promise<string>;
  listDatasets: (input: ListDatasetsInput) => Promise<DatasetListResult>;
  /** The same page without entry counts, for the browser's list surfaces (tRPC `getAll`). */
  findDatasetSummaries(input: ListDatasetsInput): Promise<DatasetSummary[]>;
  /** Each named dataset's entry count, read apart from the list so the list never waits on it. */
  countRecords(input: CountDatasetRecordsInput): Promise<DatasetRecordCount[]>;
  getBySlugOrId(input: DatasetLookupInput): Promise<Dataset>;
  findBySlugOrId(input: DatasetLookupInput): Promise<Dataset | null>;
  /** The dataset holding exactly this slug, archived or not; empty when none does. */
  findBySlug(input: { projectId: string; slug: string }): Promise<Dataset[]>;
  updateMapping(input: {
    datasetId: string;
    projectId: string;
    mapping?: { mapping: Record<string, unknown>; expansions: string[] };
    threadMapping?: { mapping: Record<string, unknown> };
  }): Promise<Dataset>;
  archiveDataset: (input: DatasetLookupInput) => Promise<{ id: string; archived: true }>;
  restoreDataset(input: { datasetId: string; projectId: string }): Promise<{ success: true }>;
  /** Archives the dataset, or restores it when `undo` is set (tRPC `deleteById`). */
  archiveOrRestoreDataset: (input: DatasetApiDeleteInput) => Promise<{ success: true }>;
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
  /**
   * The whole dataset in one answer, refused rather than truncated when it is
   * larger than the organization answers inline.
   */
  getDatasetWithinLimit: (input: DatasetLookupInput) => Promise<DatasetWithRecords>;
  /** The size limits the project's organization answers. */
  getLimits(input: { projectId: string }): Promise<DatasetLimits>;
  /** The signed upload a cell's file is sent to, within the organization's per-file limit. */
  createAttachmentUpload(
    input: CreateDatasetAttachmentUploadInput,
  ): Promise<StoredObjectsCreateUploadOutput>;
  getDatasetPage(input: DatasetPageInput): Promise<DatasetPage>;
  findDatasetPage(input: DatasetPageInput): Promise<DatasetPage | null>;
  getDatasetHead(input: DatasetLookupInput): Promise<DatasetHead>;
  listRecords: (input: DatasetPageInput) => Promise<DatasetRecordPage>;
  batchCreateRecords: (input: CreateDatasetRecordsInput & EditedBy) => Promise<DatasetRecord[]>;
  upsertRecord(
    input: UpdateDatasetRecordInput & { recordId: string } & EditedBy,
  ): Promise<DatasetRecordMutationResult>;
  deleteRecords: (input: DeleteDatasetRecordsInput & EditedBy) => Promise<{ count: number }>;
  /** Entries removed by id, refused with a 404 when none matched. */
  deleteMatchingRecords: (
    input: DeleteDatasetRecordsInput & EditedBy,
  ) => Promise<{ deletedCount: number }>;
  /** Deprecated with the multipart upload routes; retires in the next release (ADR-158 §8). */
  createDatasetFromUpload(
    input: CreateDatasetFromUploadInput,
  ): Promise<CreateDatasetFromUploadResult>;
  /** Deprecated with the multipart upload routes; retires in the next release (ADR-158 §8). */
  uploadToExistingDataset(
    input: UploadExistingDatasetInput & EditedBy,
  ): Promise<{ datasetId: string; recordsCreated: number }>;
  createDatasetFromStoredObject(
    input: CreateDatasetFromStoredObjectInput,
  ): Promise<DatasetImportStarted>;
  /** Deprecated with `POST /api/dataset/attachments`; retires in the next release (ADR-158 §8). */
  storeAttachmentUpload(input: StoreDatasetAttachmentUploadInput): Promise<StoredDatasetAttachment>;
  appendStoredObjectToDataset(
    input: AppendStoredObjectToDatasetInput & EditedBy,
  ): Promise<DatasetImportAppended>;
  retryNormalize(input: RetryNormalizeInput): Promise<UploadProcessing>;
  getByIds(input: { projectId: string; datasetIds: string[] }): Promise<Dataset[]>;
  renameDataset(input: { datasetId: string; projectId: string; name: string }): Promise<Dataset>;
  /** One row per experiment and dataset: how many ran, total cost, mean score. */
  summariseBatchEvaluations(input: { projectId: string }): Promise<BatchEvaluationSummary[]>;
  /** One batch-evaluation row, written as `POST /api/dataset/evaluate` records it. */
  createBatchEvaluation(input: BatchEvaluationEntry): Promise<void>;
  /** Every batch-evaluation record of one experiment; experiment resolves the slug. */
  listBatchEvaluations(input: {
    projectId: string;
    experimentId: string;
  }): Promise<BatchEvaluationRecord[]>;
  /**
   * The platform's own address for one dataset resource, built from the
   * project's slug and a caller-resolved path. The REST declaration is
   * static with no request-scoped builder, so the app composes this link.
   */
  platformUrl(input: { projectSlug: string; path: string }): string;
  /**
   * One id-ordered page of the project's datasets for a storage migration's
   * inventory, archived ones included: they remain recoverable customer data.
   */
  listStoragePage(input: DatasetStoragePageInput): Promise<DatasetStorageEntry[]>;
  /** The usage report's figures for these projects. */
  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<DatasetUsageCount>;

  // Versions (spec: modules/dataset/specs/dataset-versioning.feature).
  /** Newest first, with author names, and whether the layout allows a restore. */
  listVersions(input: ListDatasetVersionsInput): Promise<DatasetVersionHistory>;
  /** The current content saved by hand, optionally named; unchanged content names the latest. */
  saveVersion(input: SaveDatasetVersionInput & EditedBy): Promise<DatasetVersion>;
  getVersionPage(input: DatasetVersionPageInput): Promise<DatasetVersionPage>;
  compareVersion(input: CompareDatasetVersionInput): Promise<DatasetVersionComparison>;
  /** Writes a version's content back as a new version; history is never rewritten. */
  restoreVersion(input: DatasetVersionLookupInput & EditedBy): Promise<DatasetVersionRestored>;
  /** Keeps a version out of retention because an experiment names it. */
  pinVersion(input: DatasetVersionLookupInput): Promise<DatasetVersion>;
  /** The version a run reads: the pinned one, or the current content saved as a version. */
  resolveVersionForRun(input: {
    projectId: string;
    datasetId: string;
    version?: number;
    by: DatasetVersionAuthor;
  }): Promise<DatasetVersion>;
  /** Every row of one version. */
  readVersion(input: DatasetVersionLookupInput): Promise<DatasetVersionContent>;
  /** Records the version each dataset of a run was read at; such a version is never thinned. */
  linkRunVersions(input: {
    projectId: string;
    runId: string;
    experimentId?: string | null;
    versions: readonly { datasetId: string; versionId: string }[];
  }): Promise<void>;
  /** The dataset versions these runs read. */
  findRunVersions(input: FindRunDatasetVersionsInput): Promise<DatasetVersionRunLink[]>;
}

export const DatasetApi = moduleApi<DatasetApi>()("dataset");
