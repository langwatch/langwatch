import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import {
  datasetRecordSchema,
  type DatasetRecord,
  type DatasetRecordInput,
} from "@langwatch/dataset-contract";
import { DatasetRecordRepository } from "../dataset-record.repository";

type Database = Pick<PrismaClient, "datasetRecord">;

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type DatasetRecordDatabase = Pick<PrismaClient, "datasetRecord">;

export class PrismaDatasetRecordRepository extends DatasetRecordRepository {
  private constructor(private readonly database: Database) {
    super();
  }

  static create(database: object): PrismaDatasetRecordRepository {
    return new PrismaDatasetRecordRepository(database as Database);
  }

  async list(input: {
    datasetId: string;
    projectId: string;
    page: number;
    limit: number;
  }): Promise<{ records: DatasetRecord[]; total: number }> {
    const where = { datasetId: input.datasetId, projectId: input.projectId };
    const [rows, total] = await Promise.all([
      this.database.datasetRecord.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.database.datasetRecord.count({ where }),
    ]);
    return { records: rows.map(toDatasetRecord), total };
  }

  async createMany(input: {
    datasetId: string;
    projectId: string;
    entries: Array<DatasetRecordInput & { id: string }>;
  }): Promise<DatasetRecord[]> {
    await this.database.datasetRecord.createMany({
      data: input.entries.map((entry) => ({
        id: entry.id,
        datasetId: input.datasetId,
        projectId: input.projectId,
        entry: entry as Prisma.InputJsonValue,
      })),
    });
    const rows = await this.database.datasetRecord.findMany({
      where: {
        datasetId: input.datasetId,
        projectId: input.projectId,
        id: { in: input.entries.map((entry) => entry.id) },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toDatasetRecord);
  }

  async update(input: {
    id: string;
    datasetId: string;
    projectId: string;
    entry: Record<string, unknown>;
  }): Promise<DatasetRecord> {
    const changed = await this.database.datasetRecord.updateMany({
      where: {
        id: input.id,
        datasetId: input.datasetId,
        projectId: input.projectId,
      },
      data: { entry: input.entry as Prisma.InputJsonValue },
    });
    if (changed.count === 0) {
      const error = new Error("Dataset record not found");
      error.name = "DatasetRecordNotFoundError";
      throw error;
    }
    const row = await this.database.datasetRecord.findFirstOrThrow({
      where: {
        id: input.id,
        datasetId: input.datasetId,
        projectId: input.projectId,
      },
    });
    return toDatasetRecord(row);
  }

  async deleteMany(input: {
    datasetId: string;
    projectId: string;
    recordIds: string[];
  }): Promise<number> {
    const result = await this.database.datasetRecord.deleteMany({
      where: {
        id: { in: input.recordIds },
        datasetId: input.datasetId,
        projectId: input.projectId,
      },
    });
    return result.count;
  }
}

function toDatasetRecord(row: unknown): DatasetRecord {
  const value = row as Record<string, unknown>;
  return datasetRecordSchema.parse({
    id: value.id,
    datasetId: value.datasetId,
    projectId: value.projectId,
    entry: value.entry,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}
