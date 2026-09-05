import type { DatasetRow } from "../../ports/dataset.port";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import {
  DatasetContentRepository,
  type CreateDatasetInput,
  type DatasetContentUpdate,
  type UpdateDatasetInput,
} from "../dataset-content.repository";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type DatasetContentDatabase = Pick<
  PrismaClient,
  "dataset" | "datasetRecord" | "$transaction" | "$queryRaw" | "$executeRaw"
>;

/**
 * Max wall-clock a dataset-mutation transaction may run before Prisma aborts
 * it with P2028. Sized for the worst case: O(chunkCount) storage round-trips.
 * Prisma's 5s default P2028s on any non-trivial dataset.
 */
export const DATASET_MUTATION_TXN_TIMEOUT_MS = 120_000;

/**
 * Max wall-clock to WAIT for a pooled connection before the transaction starts,
 * separate from the run budget above. Prisma's 2s default fails a mutation on a
 * busy pool before it has done anything.
 */
export const DATASET_MUTATION_TXN_MAX_WAIT_MS = 10_000;

/** A `PrismaClient`, or the transaction-scoped client `$transaction` hands back. */
type DatasetContentClient = DatasetContentDatabase | Prisma.TransactionClient;

type CountableDataset = {
  id: string;
  contentLayout?: string | null;
  useS3?: boolean | null;
};

/**
 * Whether a dataset's entries still live in the `DatasetRecord` table. Mirrors
 * the fallback branch of `datasetDisplayRecordCount` — the two must agree, or
 * a dataset gets counted and then has its count discarded, or vice versa.
 */
const storesRowsInRecordsTable = (dataset: CountableDataset): boolean =>
  dataset.contentLayout !== "s3_jsonl" && !dataset.useS3;

/** Private Prisma owner for Dataset rows and their object-storage counters. */
export class PrismaDatasetContentRepository extends DatasetContentRepository {
  private constructor(
    private readonly prisma: DatasetContentClient,
    /** Absent on a transaction-scoped instance — only the root can open one. */
    private readonly root: DatasetContentDatabase | null,
  ) {
    super();
  }

  static create(prisma: DatasetContentDatabase): PrismaDatasetContentRepository {
    return new PrismaDatasetContentRepository(prisma, prisma);
  }

  /**
   * ADR-032 Decision 9: runs `mutate` under this dataset's advisory lock inside
   * one transaction (I-COUNT). Receives a REPOSITORY bound to the transaction,
   * since the caller is a service and holds no database client.
   */
  async withDatasetLock<T>(
    datasetId: string,
    mutate: (tx: DatasetContentRepository) => Promise<T>,
  ): Promise<T> {
    if (!this.root) {
      throw new Error("withDatasetLock cannot nest: this repository is already transactional");
    }

    return await this.root.$transaction(
      async (client) => {
        // `$executeRaw`, not `$queryRaw`: pg_advisory_xact_lock returns void,
        // which $queryRaw cannot deserialize. The lock is held for the whole
        // transaction, which is what serializes the mutation.
        await client.$executeRaw`-- @tenancy: advisory-lock helper, key is dataset-bounded
SELECT pg_advisory_xact_lock(hashtextextended(${`dataset:${datasetId}`}, 0))`;
        return await mutate(new PrismaDatasetContentRepository(client, null));
      },
      {
        timeout: DATASET_MUTATION_TXN_TIMEOUT_MS,
        maxWait: DATASET_MUTATION_TXN_MAX_WAIT_MS,
      },
    );
  }

  /**
   * Finds a single dataset by id within a project.
   */
  async tryFindOne(input: { id: string; projectId: string }): Promise<DatasetRow | null> {
    const client = this.prisma;
    return await client.dataset.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
    });
  }

  /**
   * Finds a single dataset by id within a project, throwing if absent. The
   * s3_jsonl write-mutations re-read the row inside the advisory lock, where a
   * miss is an invariant violation — the throwing counterpart to {@link findOne}.
   */
  async findOneOrThrow(input: { id: string; projectId: string }): Promise<DatasetRow> {
    const client = this.prisma;
    return await client.dataset.findFirstOrThrow({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
    });
  }

  /**
   * Finds dataset by slug within a project.
   */
  async tryFindBySlug(input: {
    slug: string;
    projectId: string;
    excludeId?: string;
  }): Promise<DatasetRow | null> {
    const client = this.prisma;
    return await client.dataset.findFirst({
      where: {
        slug: input.slug,
        projectId: input.projectId,
        ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      },
    });
  }

  /**
   * Creates a new dataset.
   */
  async create(input: CreateDatasetInput): Promise<DatasetRow> {
    const client = this.prisma;
    return await client.dataset.create({
      data: input as Prisma.DatasetUncheckedCreateInput,
    });
  }

  /**
   * Updates an existing dataset and returns the updated row. `where` pins both
   * id and projectId, so a cross-project update matches nothing and Prisma
   * throws `P2025` — the tenancy guard IS the where clause.
   */
  async update(input: UpdateDatasetInput): Promise<DatasetRow> {
    const client = this.prisma;

    return await client.dataset.update({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
      data: input.data as Prisma.DatasetUncheckedUpdateInput,
    });
  }

  /**
   * Writes back what a chunk mutation computed. Same row guard and same
   * transaction plumbing as `update`; the difference is that the caller states
   * counters and offsets rather than a Prisma update document.
   */
  async updateContent(input: {
    id: string;
    projectId: string;
    content: DatasetContentUpdate;
  }): Promise<DatasetRow> {
    const { chunkOffsets, columnTypes, ...scalars } = input.content;

    return await this.update({
      id: input.id,
      projectId: input.projectId,
      data: {
        ...scalars,
        ...(chunkOffsets !== undefined ? { chunkOffsets } : {}),
        ...(columnTypes !== undefined ? { columnTypes } : {}),
      },
    });
  }

  /**
   * Hard-delete a still-pending upload row. Guarded on `status='uploading'`
   * (a `deleteMany`) so a finalize racing to `processing` in between is never
   * destroyed — the predicate then matches 0 rows. Returns the count deleted.
   */
  async deletePendingUpload(input: { id: string; projectId: string }): Promise<number> {
    const client = this.prisma;
    const { count } = await client.dataset.deleteMany({
      where: {
        id: input.id,
        projectId: input.projectId,
        status: "uploading",
      },
    });
    return count;
  }

  /**
   * Conditionally flip a dataset to `failed` ONLY while still `processing`. The
   * normalize enqueue catch uses this when the enqueue rejects synchronously.
   * Guarded (`updateMany`) so it never clobbers a more specific handler error.
   */
  async failIfProcessing(input: {
    id: string;
    projectId: string;
    statusError: string;
  }): Promise<number> {
    const { count } = await this.prisma.dataset.updateMany({
      where: {
        id: input.id,
        projectId: input.projectId,
        status: "processing",
      },
      data: { status: "failed", statusError: input.statusError },
    });
    return count;
  }

  /**
   * Atomically claim a pending upload: flip `uploading` → `processing` only if
   * still `uploading`. The `updateMany` WHERE-clause is the concurrency guard —
   * two racing finalize calls can't both win. Returns rows claimed (1 = won).
   */
  async claimForProcessing(input: { id: string; projectId: string }): Promise<number> {
    const { count } = await this.prisma.dataset.updateMany({
      where: {
        id: input.id,
        projectId: input.projectId,
        status: "uploading",
        archivedAt: null,
      },
      data: { status: "processing" },
    });
    return count;
  }

  /**
   * Records a normalize re-drive on a wedged `processing` row by bumping
   * `updatedAt` (a no-op write is just the `@updatedAt` trigger). Guarded so it
   * never resurrects a row that raced to `ready`/`failed` since selection.
   */
  async markProcessingRedriven(input: { id: string; projectId: string }): Promise<number> {
    const { count } = await this.prisma.dataset.updateMany({
      where: {
        id: input.id,
        projectId: input.projectId,
        status: "processing",
      },
      data: { statusError: null },
    });
    return count;
  }

  /**
   * Finds datasets wedged mid-normalize: `processing` rows whose `updatedAt`
   * predates `olderThan`. Drives the poll-triggered re-drive (see
   * `DatasetService.reapStaleProcessing`). Not `createdAt`: a retry re-enters.
   */
  async findStaleProcessing(input: { projectId: string; olderThan: Date }): Promise<DatasetRow[]> {
    return await this.prisma.dataset.findMany({
      where: {
        projectId: input.projectId,
        status: "processing",
        archivedAt: null,
        stagingKey: { not: null },
        updatedAt: { lt: input.olderThan },
      },
    });
  }

  /**
   * Finds the pending dataset that owns a given staging key. The direct-upload
   * route uses this to refuse a stream into a `staging/` slot no row claims.
   * `stagingKey` is server-minted and bound at presign time.
   */
  async tryFindPendingUploadByStagingKey(input: {
    projectId: string;
    stagingKey: string;
  }): Promise<DatasetRow | null> {
    return await this.prisma.dataset.findFirst({
      where: {
        projectId: input.projectId,
        stagingKey: input.stagingKey,
        status: "uploading",
        archivedAt: null,
      },
    });
  }

  /**
   * Finds abandoned pending uploads: `status='uploading'` rows created before
   * `olderThan`. Drives the poll-triggered reap (see
   * `DatasetService.reapStalePendingUploads`) without a scheduler.
   */
  async findStalePendingUploads(input: {
    projectId: string;
    olderThan: Date;
  }): Promise<DatasetRow[]> {
    return await this.prisma.dataset.findMany({
      where: {
        projectId: input.projectId,
        status: "uploading",
        archivedAt: null,
        createdAt: { lt: input.olderThan },
      },
    });
  }

  /**
   * Finds all dataset slugs in a project (for name conflict checking).
   */
  async findAllSlugs(input: { projectId: string }): Promise<Array<{ slug: string }>> {
    return await this.prisma.dataset.findMany({
      where: { projectId: input.projectId },
      select: { slug: true },
    });
  }

  /**
   * Lists non-archived datasets for a project with pagination and record counts.
   */
  async listPaginated(input: { projectId: string; skip: number; take: number }): Promise<{
    datasets: Array<DatasetRow & { _count: { datasetRecords: number } }>;
    total: number;
  }> {
    const where = { projectId: input.projectId, archivedAt: null };

    const [page, total] = await Promise.all([
      this.prisma.dataset.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: input.skip,
        take: input.take,
      }),
      this.prisma.dataset.count({ where }),
    ]);

    const datasets = await this.attachRecordCounts(input.projectId, page);

    return { datasets, total };
  }

  /**
   * Attaches the `_count.datasetRecords` shape lists render, WITHOUT Prisma's
   * relation-count `include` (an untenanted subquery over every tenant).
   * Skipped entirely for `s3_jsonl`/`useS3` datasets, whose count is a column.
   */
  private async attachRecordCounts<T extends CountableDataset>(
    projectId: string,
    datasets: T[],
  ): Promise<Array<T & { _count: { datasetRecords: number } }>> {
    const datasetIds = datasets.filter(storesRowsInRecordsTable).map((dataset) => dataset.id);

    const grouped =
      datasetIds.length > 0
        ? await this.prisma.datasetRecord.groupBy({
            by: ["datasetId"],
            where: { projectId, datasetId: { in: datasetIds } },
            _count: { _all: true },
          })
        : [];

    const countByDatasetId = new Map(grouped.map((row) => [row.datasetId, row._count._all]));

    return datasets.map((dataset) => ({
      ...dataset,
      _count: { datasetRecords: countByDatasetId.get(dataset.id) ?? 0 },
    }));
  }
}
