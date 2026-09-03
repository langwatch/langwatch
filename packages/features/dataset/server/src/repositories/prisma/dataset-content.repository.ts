import type { DatasetRow } from "../../ports/dataset.port";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * Input types derived from Prisma for type safety
 */
/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type DatasetContentDatabase = Pick<
  PrismaClient,
  "dataset" | "datasetRecord" | "$transaction" | "$queryRaw" | "$executeRaw"
>;

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
 * the storage vocabulary on the storage side; the casts happen once, below.
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
 * Repository layer for dataset data access.
 * Single Responsibility: Database operations for datasets.
 * {@link Dataset} represents a collection of data records with associated metadata.
 */
/**
 * Max wall-clock a dataset-mutation transaction may run before Prisma aborts it
 * with P2028. Sized for the worst case inside the lock: edit, delete and count
 * recomputation do O(chunkCount) read + rewrite calls, each a round-trip to
 * object storage. Prisma's 5s default P2028s on any non-trivial dataset.
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

export class DatasetContentRepository {
  private constructor(
    private readonly prisma: DatasetContentClient,
    /** Absent on a transaction-scoped instance — only the root can open one. */
    private readonly root: DatasetContentDatabase | null,
  ) {}

  static create(prisma: DatasetContentDatabase): DatasetContentRepository {
    return new DatasetContentRepository(prisma, prisma);
  }

  /**
   * ADR-032 Decision 9: runs `mutate` under this dataset's advisory lock, inside
   * one transaction, so a chunk write and the counter update it implies commit
   * or roll back together (I-COUNT). Without it two concurrent appends both read
   * `chunkCount=N`, both write `chunk-N`, and one is lost with the offset index
   * left drifting.
   *
   * `mutate` receives a REPOSITORY bound to the transaction, not Prisma's
   * transaction client: the caller is a service, and a service does not hold a
   * database client. The advisory key is namespaced per dataset, so mutations of
   * different datasets never block each other.
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
        return await mutate(new DatasetContentRepository(client, null));
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
   * Finds a single dataset by id within a project, throwing if absent.
   *
   * The s3_jsonl write-mutations re-read the row inside the per-dataset advisory
   * lock, where its existence is already guaranteed by the lock — a miss there is
   * an invariant violation, not a not-found to branch on. This is the throwing
   * counterpart to {@link findOne} so those paths surface it loudly (Prisma's
   * `NotFoundError`) instead of null-checking a "can't happen".
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
      data: input,
    });
  }

  /**
   * Updates an existing dataset and returns the updated row.
   *
   * The `where` pins BOTH id and projectId, so a cross-project update simply
   * doesn't match any row and Prisma throws `P2025` (NotFoundError) — the tenancy
   * guard IS the where clause. Prisma's `update` already returns the updated row,
   * so we return it directly (no redundant re-read — these run under the dataset
   * advisory lock where every extra round-trip lengthens lock hold).
   *
   * @throws {Prisma.PrismaClientKnownRequestError} P2025 if no row matches id+project
   */
  async update(input: UpdateDatasetInput): Promise<DatasetRow> {
    const client = this.prisma;

    return await client.dataset.update({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
      data: input.data,
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
        ...(chunkOffsets !== undefined
          ? { chunkOffsets: chunkOffsets as Prisma.InputJsonValue }
          : {}),
        ...(columnTypes !== undefined ? { columnTypes: columnTypes as Prisma.InputJsonValue } : {}),
      },
    });
  }

  /**
   * Hard-delete a still-pending upload row. Guarded on `status='uploading'`
   * (a `deleteMany`, not `delete`) so a finalize that raced in between the
   * caller's status check and this call — flipping the row to `processing` — is
   * never destroyed: the predicate then matches 0 rows and the now-live dataset
   * survives. A pending upload never held content (no records, no committed
   * chunks), so it is detritus to discard, not a dataset to archive; deleting it
   * frees the slug naturally and leaves no content-less ghost behind. The
   * id+projectId predicate is the tenancy guard. Returns the count deleted
   * (0 = already reaped, or no longer pending).
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
   * Conditionally flip a dataset to `failed` ONLY while it is still
   * `processing`. The normalize enqueue catch uses this: when the enqueue
   * rejects synchronously no job is in flight, so the row's `processing` is a
   * lie — flip it to `failed` so the UI exposes retry. Guarded on
   * `status='processing'` (an `updateMany`, not `update`) so it never clobbers
   * the more specific error the inline handler already set on ITS own failure
   * path (the handler flips to `failed` + rethrows, so by the time this runs the
   * row is already `failed` and this matches no row). Returns the rows flipped
   * (0 = the handler — or a concurrent finalize — already moved it).
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
   * Atomically claim a pending upload for normalization: flip `uploading` →
   * `processing` ONLY if the row is still `uploading` (and non-archived). The
   * `updateMany` WHERE-clause is the concurrency guard — two finalize calls
   * racing (double-click / client retry) can't both win, so only one enqueues a
   * normalize. A read-then-`update` would let both pass the `status==='uploading'`
   * read and both transition + enqueue, racing two handlers onto the same chunk
   * keys in inline mode. Returns the rows claimed (1 = won, 0 = a concurrent
   * finalize already moved it).
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
   * `updatedAt` (Prisma's `@updatedAt` fires on any update; the no-op
   * `statusError: null` write is just the trigger — a processing row already has
   * a null error). Guarded on `status='processing'` (an `updateMany`) so it can
   * never resurrect a row that raced to `ready`/`failed` between selection and
   * re-drive. This stops `findStaleProcessing` from re-selecting the same row on
   * every subsequent upload within the TTL. Returns the rows touched.
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
   * Finds datasets wedged mid-normalize: `status='processing'`, non-archived
   * rows with a bound staging key whose `updatedAt` (the moment they flipped to
   * `processing`) predates `olderThan`. Drives the poll-triggered re-drive (see
   * `DatasetService.reapStaleProcessing`) that recovers the *lost-after-send*
   * normalize window without a scheduler. Keyed on `updatedAt`, not `createdAt`:
   * a retried row re-enters `processing` long after it was created, so the clock
   * must start when normalization (re)started.
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
   * Finds the pending (`status='uploading'`, non-archived) dataset that owns a
   * given staging key. The direct-upload staging route uses this to refuse a
   * stream into a `staging/` slot no upload row claims — otherwise an authed
   * project user could spray orphan objects there. `stagingKey` is server-minted
   * and bound to the row at presign time.
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
   * Finds abandoned pending uploads in a project: `status='uploading'`,
   * non-archived rows created before `olderThan`. Drives the poll-triggered
   * reap (see `DatasetService.reapStalePendingUploads`) that bounds the
   * accumulation of stuck `uploading` rows + their staging objects without a
   * scheduler. The `olderThan` cutoff is conservative (well beyond the presign
   * TTL) so a still-in-flight upload is never matched.
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
   * Attaches the `_count.datasetRecords` shape that dataset lists render,
   * without Prisma's relation-count `include`.
   *
   * Prisma compiles `include: { _count: { select: { datasetRecords: true } } }`
   * into a subquery with no tenancy predicate at all:
   *
   *   LEFT JOIN (SELECT "datasetId", COUNT(*) FROM "DatasetRecord"
   *              WHERE 1=1 GROUP BY "datasetId") ...
   *
   * so every dataset list aggregates the whole `DatasetRecord` table across
   * every tenant, and one customer's list costs more as the others grow.
   *
   * Counting here keeps the read inside the project and inside the datasets
   * that actually store rows in that table: `s3_jsonl` and legacy `useS3`
   * datasets keep their content in object storage, so their row count is
   * already a column on `Dataset` and their `DatasetRecord` count is a
   * guaranteed zero nobody reads. A project fully on object storage issues no
   * count query at all.
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
