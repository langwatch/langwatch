import {
  type PrismaClient,
  type Dataset,
  type Prisma,
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
  data: {
    name?: string;
    slug?: string;
    columnTypes?: Prisma.InputJsonValue;
  };
};

/**
 * Repository layer for dataset data access.
 * Single Responsibility: Database operations for datasets.
 */
export class DatasetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Finds a single dataset by id within a project.
   */
  async findOne(input: {
    id: string;
    projectId: string;
  }): Promise<Dataset | null> {
    return await this.prisma.dataset.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
    });
  }

  /**
   * Finds dataset by slug within a project.
   */
  async findBySlug(input: {
    slug: string;
    projectId: string;
    excludeId?: string;
  }): Promise<Dataset | null> {
    return await this.prisma.dataset.findFirst({
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
    const { projectId, ...data } = input;

    return await this.prisma.dataset.create({
      data: {
        ...data,
        project: {
          connect: { id: projectId },
        },
      },
    });
  }

  /**
   * Updates an existing dataset.
   */
  async update(input: UpdateDatasetInput): Promise<Dataset> {
    return await this.prisma.dataset.update({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
      data: input.data,
    });
  }

  /**
   * Gets project with organization info for S3 configuration check.
   */
  async getProjectWithOrgS3Settings(projectId: string): Promise<{
    canUseS3: boolean;
  }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { team: { include: { organization: true } } },
    });

    return {
      canUseS3: project?.team?.organization?.useCustomS3 ?? false,
    };
  }

  /**
   * Finds all dataset records for a dataset.
   */
  async findDatasetRecords(input: {
    datasetId: string;
    projectId: string;
  }) {
    return await this.prisma.datasetRecord.findMany({
      where: {
        datasetId: input.datasetId,
        projectId: input.projectId,
      },
    });
  }

  /**
   * Updates dataset records in a transaction.
   */
  async updateDatasetRecordsTransaction(
    updates: Array<{
      id: string;
      datasetId: string;
      projectId: string;
      entry: Prisma.InputJsonValue;
    }>
  ): Promise<void> {
    await this.prisma.$transaction(
      updates.map((update) =>
        this.prisma.datasetRecord.update({
          where: {
            id: update.id,
            datasetId: update.datasetId,
            projectId: update.projectId,
          },
          data: {
            entry: update.entry,
          },
        })
      )
    );
  }

  /**
   * Finds experiment by id and project.
   */
  async findExperiment(input: { id: string; projectId: string }) {
    return await this.prisma.experiment.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
    });
  }

  /**
   * Finds all dataset slugs in a project (for name conflict checking).
   */
  async findAllSlugs(projectId: string): Promise<Array<{ slug: string }>> {
    return await this.prisma.dataset.findMany({
      where: { projectId },
      select: { slug: true },
    });
  }
}

