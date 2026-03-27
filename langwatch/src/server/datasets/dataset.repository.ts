import type { Dataset, DatasetRecord, Prisma, PrismaClient } from "@prisma/client";

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
  async create(input: CreateDatasetInput): Promise<Dataset> {
    return await this.prisma.dataset.create({
      data: input,
    });
  }

  /**
   * Updates an existing dataset.
   *
   * Validates that the dataset belongs to the specified project before updating.
   * This guard prevents cross-project updates at the data layer.
   *
   * @throws {Error} if dataset not found or doesn't belong to project
   */
  async update(
    input: UpdateDatasetInput,
    options?: {
      tx?: Prisma.TransactionClient;
    },
  ): Promise<Dataset> {
    const client = options?.tx ?? this.prisma;

    const result = await client.dataset.update({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
      data: input.data,
    });

    if (!result) {
      throw new Error(
        `Dataset ${input.id} not found in project ${input.projectId}`,
      );
    }

    // Return the updated dataset
    return await client.dataset.findFirstOrThrow({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
    });
  }

  /**
   * Gets project with organization info for S3 configuration check.
   */
  async getProjectWithOrgS3Settings(input: { projectId: string }): Promise<{
    canUseS3: boolean;
  }> {
    const project = await this.prisma.project.findUnique({
      where: { id: input.projectId },
      include: { team: { include: { organization: true } } },
    });

    return {
      canUseS3: project?.team?.organization?.useCustomS3 ?? false,
    };
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

  /**
   * Finds a dataset with all its records.
   */
  async findWithRecords(input: {
    datasetId: string;
    projectId: string;
  }): Promise<{ dataset: Dataset; records: DatasetRecord[] } | null> {
    const dataset = await this.prisma.dataset.findFirst({
      where: { id: input.datasetId, projectId: input.projectId },
    });

    if (!dataset) return null;

    const records = await this.prisma.datasetRecord.findMany({
      where: { datasetId: input.datasetId, projectId: input.projectId },
    });

    return { dataset, records };
  }
}
