import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import {
  datasetColumnsSchema,
  datasetSchema,
  type Dataset,
  type DatasetSummary,
} from "@langwatch/dataset-contract";
import {
  DatasetRepository,
  type DatasetCreateInput,
  type DatasetUpdateInput,
} from "../dataset.repository";

type Database = Pick<PrismaClient, "dataset">;

export class PrismaDatasetRepository extends DatasetRepository {
  private constructor(private readonly database: Database) {
    super();
  }

  static create(database: object): PrismaDatasetRepository {
    return new PrismaDatasetRepository(database as Database);
  }

  async tryFindById(input: {
    id: string;
    projectId: string;
    includeArchived?: boolean;
  }): Promise<Dataset | null> {
    const row = await this.database.dataset.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
        ...(input.includeArchived ? {} : { archivedAt: null }),
      },
    });
    return row ? toDataset(row) : null;
  }

  async tryFindBySlug(input: {
    slug: string;
    projectId: string;
    excludeId?: string;
    includeArchived?: boolean;
  }): Promise<Dataset | null> {
    const row = await this.database.dataset.findFirst({
      where: {
        slug: input.slug,
        projectId: input.projectId,
        ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
        ...(input.includeArchived ? {} : { archivedAt: null }),
      },
    });
    return row ? toDataset(row) : null;
  }

  async list(input: {
    projectId: string;
    page: number;
    limit: number;
  }): Promise<DatasetSummary[]> {
    const rows = await this.database.dataset.findMany({
      where: { projectId: input.projectId, archivedAt: null },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      include: { _count: { select: { datasetRecords: true } } },
    });
    return rows.map((row) => ({
      ...toDataset(row),
      recordCount: row._count.datasetRecords,
    }));
  }

  async create(input: DatasetCreateInput): Promise<Dataset> {
    const row = await this.database.dataset.create({
      data: {
        projectId: input.projectId,
        name: input.name,
        slug: input.slug,
        columnTypes: input.columnTypes as Prisma.InputJsonValue,
      },
    });
    return toDataset(row);
  }

  async update(input: DatasetUpdateInput): Promise<Dataset> {
    const row = await this.database.dataset.update({
      where: { id: input.id },
      data: {
        name: input.name,
        slug: input.slug,
        columnTypes: input.columnTypes as Prisma.InputJsonValue,
      },
    });
    return toDataset(row);
  }

  async archive(input: {
    id: string;
    projectId: string;
    slug: string;
    archivedAt: Date | null;
  }): Promise<Dataset> {
    const row = await this.database.dataset.updateMany({
      where: { id: input.id, projectId: input.projectId },
      data: { slug: input.slug, archivedAt: input.archivedAt },
    });
    if (row.count === 0) {
      throw new Error("Dataset was not found while archiving");
    }
    const archived = await this.tryFindById({
      id: input.id,
      projectId: input.projectId,
      includeArchived: true,
    });
    if (!archived) throw new Error("Dataset disappeared while archiving");
    return archived;
  }

  async restore(input: {
    id: string;
    projectId: string;
    slug: string;
  }): Promise<Dataset> {
    const changed = await this.database.dataset.updateMany({
      where: { id: input.id, projectId: input.projectId },
      data: { slug: input.slug, archivedAt: null },
    });
    if (changed.count === 0) throw new Error("Dataset was not found while restoring");
    const restored = await this.tryFindById({
      id: input.id,
      projectId: input.projectId,
      includeArchived: true,
    });
    if (!restored) throw new Error("Dataset disappeared while restoring");
    return restored;
  }

  async updateMapping(input: {
    id: string;
    projectId: string;
    mapping: Record<string, unknown>;
  }): Promise<Dataset> {
    const changed = await this.database.dataset.updateMany({
      where: { id: input.id, projectId: input.projectId },
      data: { mapping: input.mapping as Prisma.InputJsonValue },
    });
    if (changed.count === 0)
      throw new Error("Dataset was not found while updating mapping");
    const updated = await this.tryFindById({
      id: input.id,
      projectId: input.projectId,
      includeArchived: true,
    });
    if (!updated) throw new Error("Dataset disappeared while updating mapping");
    return updated;
  }

  async count(input: { projectId: string; slug: string }): Promise<number> {
    return this.database.dataset.count({
      where: { projectId: input.projectId, slug: input.slug },
    });
  }
}

function toDataset(row: unknown): Dataset {
  const value = row as Record<string, unknown>;
  return datasetSchema.parse({
    id: value.id,
    projectId: value.projectId,
    name: value.name,
    slug: value.slug,
    columnTypes: datasetColumnsSchema.parse(value.columnTypes),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    archivedAt: value.archivedAt ?? null,
    mapping: value.mapping ?? null,
    useS3: value.useS3 ?? false,
    s3RecordCount: value.s3RecordCount ?? null,
    contentLayout: value.contentLayout ?? "postgres",
    status: value.status ?? "ready",
    statusError: value.statusError ?? null,
    stagingKey: value.stagingKey ?? null,
    uploadFilename: value.uploadFilename ?? null,
    rowCount: value.rowCount ?? null,
    sizeBytes: value.sizeBytes ?? null,
    chunkCount: value.chunkCount ?? null,
    chunkOffsets: value.chunkOffsets ?? null,
  });
}
