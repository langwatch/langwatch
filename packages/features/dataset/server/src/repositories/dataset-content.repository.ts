import type { Prisma } from "@langwatch/prisma-client/generated";
import type { DatasetRow } from "../ports/dataset.port";

export type CreateDatasetInput = Omit<
  Prisma.DatasetCreateInput,
  "project" | "datasetRecords" | "batchEvaluations"
> & {
  projectId: string;
};

export type UpdateDatasetInput = {
  id: string;
  projectId: string;
  data: Prisma.DatasetUpdateInput;
};

/**
 * The fields a chunk mutation writes back, in the feature's own vocabulary.
 *
 * The chunk service used to build `Prisma.DatasetUpdateInput` itself, which
 * meant seven `as unknown as Prisma.InputJsonValue` casts in a service — the
 * JSON columns are the only reason those existed. Naming the shape here keeps
 * the storage vocabulary on the storage side.
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
   * ADR-032 Decision 9: runs `mutate` under this dataset's advisory lock, inside
   * one transaction, so a chunk write and the counter update it implies commit
   * or roll back together (I-COUNT). `mutate` receives a REPOSITORY bound to the
   * transaction, not a database client: the caller is a service, and a service
   * does not hold one.
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
