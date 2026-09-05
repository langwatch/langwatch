import type { DatasetRow } from "../ports/dataset.port";

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
  createdAt?: Date | string;
  updatedAt?: Date | string;
  archivedAt?: Date | string | null;
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
export abstract class DatasetContentRepository {
  /**
   * ADR-032 Decision 9: runs `mutate` under this dataset's advisory lock
   * inside one transaction (I-COUNT). Receives a REPOSITORY bound to the
   * transaction, not a database client, since the caller is a service.
   */
  abstract withDatasetLock<T>(
    datasetId: string,
    mutate: (tx: DatasetContentRepository) => Promise<T>,
  ): Promise<T>;
  abstract tryFindOne(input: { id: string; projectId: string }): Promise<DatasetRow | null>;
  /** The throwing counterpart to {@link tryFindOne}, for reads inside the lock. */
  abstract findOneOrThrow(input: { id: string; projectId: string }): Promise<DatasetRow>;
  abstract tryFindBySlug(input: {
    slug: string;
    projectId: string;
    excludeId?: string;
  }): Promise<DatasetRow | null>;
  abstract create(input: CreateDatasetInput): Promise<DatasetRow>;
  abstract update(input: UpdateDatasetInput): Promise<DatasetRow>;
  abstract updateContent(input: {
    id: string;
    projectId: string;
    content: DatasetContentUpdate;
  }): Promise<DatasetRow>;
  abstract deletePendingUpload(input: { id: string; projectId: string }): Promise<number>;
  abstract failIfProcessing(input: {
    id: string;
    projectId: string;
    statusError: string;
  }): Promise<number>;
  abstract claimForProcessing(input: { id: string; projectId: string }): Promise<number>;
  abstract markProcessingRedriven(input: { id: string; projectId: string }): Promise<number>;
  abstract findStaleProcessing(input: {
    projectId: string;
    olderThan: Date;
  }): Promise<DatasetRow[]>;
  abstract tryFindPendingUploadByStagingKey(input: {
    projectId: string;
    stagingKey: string;
  }): Promise<DatasetRow | null>;
  abstract findStalePendingUploads(input: {
    projectId: string;
    olderThan: Date;
  }): Promise<DatasetRow[]>;
  abstract findAllSlugs(input: { projectId: string }): Promise<Array<{ slug: string }>>;
  abstract listPaginated(input: { projectId: string; skip: number; take: number }): Promise<{
    datasets: Array<DatasetRow & { _count: { datasetRecords: number } }>;
    total: number;
  }>;
}
