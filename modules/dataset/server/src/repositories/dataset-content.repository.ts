import type { DatasetRow } from "./dataset.repository.ts";
import type { Instant, TimeInput } from "@langwatch/time";

/** A Json column's value, mirroring the generated client's own shape. */
export type DatasetJsonObject = { [Key in string]?: DatasetJsonValue };
export type DatasetJsonArray = DatasetJsonValue[];
export type DatasetJsonValue =
  | string
  | number
  | boolean
  | DatasetJsonObject
  | DatasetJsonArray
  | null;

/** The columns a dataset row is written with, minus its relations. */
export type DatasetWriteFields = {
  id?: string;
  name?: string;
  slug?: string;
  columnTypes?: DatasetJsonValue;
  createdAt?: TimeInput;
  updatedAt?: TimeInput;
  archivedAt?: TimeInput | null;
  mapping?: DatasetJsonValue | null;
  useS3?: boolean;
  s3RecordCount?: number | null;
  contentLayout?: string;
  status?: string;
  statusError?: string | null;
  stagingKey?: string | null;
  uploadFilename?: string | null;
  rowCount?: number | null;
  sizeBytes?: bigint | number | null;
  chunkCount?: number | null;
  chunkOffsets?: DatasetJsonValue | null;
};

export type CreateDatasetInput = DatasetWriteFields & {
  name: string;
  slug: string;
  columnTypes: DatasetJsonValue;
  projectId: string;
};

export type UpdateDatasetInput = {
  id: string;
  projectId: string;
  data: DatasetWriteFields;
};

/**
 * The fields a chunk mutation writes back, in the feature's own vocabulary —
 * naming the shape here keeps storage vocabulary (and its JSON casts) off
 * the service, which used to build `Prisma.DatasetUpdateInput` itself.
 */
export type DatasetContentUpdate = {
  rowCount?: number;
  sizeBytes?: bigint;
  chunkCount?: number;
  chunkOffsets?: unknown;
  columnTypes?: unknown;
  name?: string;
  slug?: string;
};

/**
 * Dataset rows and the counters an object-backed dataset keeps beside its
 * chunks. The chunk and normalization services depend on this class; the
 * Prisma implementation beside it is chosen at the composition root.
 */
export interface DatasetContentRepository {
  /**
   * ADR-032 Decision 9: runs `mutate` under this dataset's advisory lock
   * inside one transaction (I-COUNT). Receives a REPOSITORY bound to the
   * transaction, not a database client, since the caller is a service.
   */
  withDatasetLock<T>(
    datasetId: string,
    mutate: (tx: DatasetContentRepository) => Promise<T>,
  ): Promise<T>;
  findOne(input: { id: string; projectId: string }): Promise<DatasetRow | null>;
  /** The throwing counterpart to {@link findOne}, for reads inside the lock. */
  getOne(input: { id: string; projectId: string }): Promise<DatasetRow>;
  findBySlug(input: {
    slug: string;
    projectId: string;
    excludeId?: string;
  }): Promise<DatasetRow | null>;
  create(input: CreateDatasetInput): Promise<DatasetRow>;
  update(input: UpdateDatasetInput): Promise<DatasetRow>;
  updateContent(input: {
    id: string;
    projectId: string;
    content: DatasetContentUpdate;
  }): Promise<DatasetRow>;
  deletePendingUpload(input: { id: string; projectId: string }): Promise<number>;
  failIfProcessing(input: {
    id: string;
    projectId: string;
    statusError: string;
  }): Promise<number>;
  claimForProcessing(input: { id: string; projectId: string }): Promise<number>;
  markProcessingRedriven(input: { id: string; projectId: string }): Promise<number>;
  findStaleProcessing(input: { projectId: string; olderThan: Instant }): Promise<DatasetRow[]>;
  findPendingUploadByStagingKey(input: {
    projectId: string;
    stagingKey: string;
  }): Promise<DatasetRow | null>;
  findStalePendingUploads(input: {
    projectId: string;
    olderThan: Instant;
  }): Promise<DatasetRow[]>;
  findAllSlugs(input: { projectId: string }): Promise<Array<{ slug: string }>>;
  listPaginated(input: { projectId: string; skip: number; take: number }): Promise<{
    datasets: Array<DatasetRow & { _count: { datasetRecords: number } }>;
    total: number;
  }>;
}
