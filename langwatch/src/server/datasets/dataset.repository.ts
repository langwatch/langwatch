import type {
  Dataset,
  DatasetRecord,
  Prisma,
  PrismaClient,
} from "@prisma/client";

/**
 * Input types derived from Prisma for type safety
 */
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
 * Repository layer for dataset data access.
 * Single Responsibility: Database operations for datasets.
 * {@link Dataset} represents a collection of data records with associated metadata.
 */
export class DatasetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Finds a single dataset by id within a project.
   */
  async findOne(
    input: {
      id: string;
      projectId: string;
    },
    options?: {
      tx?: Prisma.TransactionClient;
    },
  ): Promise<Dataset | null> {
    const client = options?.tx ?? this.prisma;
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
  async findOneOrThrow(
    input: {
      id: string;
      projectId: string;
    },
    options?: {
      tx?: Prisma.TransactionClient;
    },
  ): Promise<Dataset> {
    const client = options?.tx ?? this.prisma;
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
  async findBySlug(
    input: {
      slug: string;
      projectId: string;
      excludeId?: string;
    },
    options?: {
      tx?: Prisma.TransactionClient;
    },
  ): Promise<Dataset | null> {
    const client = options?.tx ?? this.prisma;
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
  async create(
    input: CreateDatasetInput,
    options?: {
      tx?: Prisma.TransactionClient;
    },
  ): Promise<Dataset> {
    const client = options?.tx ?? this.prisma;
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
  async update(
    input: UpdateDatasetInput,
    options?: {
      tx?: Prisma.TransactionClient;
    },
  ): Promise<Dataset> {
    const client = options?.tx ?? this.prisma;

    return await client.dataset.update({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
      data: input.data,
    });
  }

  /**
   * Finds the pending (`status='uploading'`, non-archived) dataset that owns a
   * given staging key. The direct-upload staging route uses this to refuse a
   * stream into a `staging/` slot no upload row claims — otherwise an authed
   * project user could spray orphan objects there. `stagingKey` is server-minted
   * and bound to the row at presign time.
   */
  async findPendingUploadByStagingKey(input: {
    projectId: string;
    stagingKey: string;
  }): Promise<Dataset | null> {
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
  }): Promise<Dataset[]> {
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
  async findAllSlugs(input: {
    projectId: string;
  }): Promise<Array<{ slug: string }>> {
    return await this.prisma.dataset.findMany({
      where: { projectId: input.projectId },
      select: { slug: true },
    });
  }

  /**
   * Finds a dataset by slug or id within a project, excluding archived datasets.
   */
  async findBySlugOrId(input: {
    slugOrId: string;
    projectId: string;
  }): Promise<Dataset | null> {
    return await this.prisma.dataset.findFirst({
      where: {
        projectId: input.projectId,
        archivedAt: null,
        OR: [{ slug: input.slugOrId }, { id: input.slugOrId }],
      },
    });
  }

  /**
   * Lists non-archived datasets for a project with pagination and record counts.
   */
  async listPaginated(input: {
    projectId: string;
    skip: number;
    take: number;
  }): Promise<{
    datasets: Array<Dataset & { _count: { datasetRecords: number } }>;
    total: number;
  }> {
    const where = { projectId: input.projectId, archivedAt: null };

    const [datasets, total] = await Promise.all([
      this.prisma.dataset.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { datasetRecords: true } } },
        skip: input.skip,
        take: input.take,
      }),
      this.prisma.dataset.count({ where }),
    ]);

    return { datasets, total };
  }
}
