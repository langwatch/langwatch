import {
  datasetRecordSchema,
  DatasetRecordNotFoundError,
  type DatasetRecord,
  type DatasetRecordInput,
} from "@langwatch/dataset-contract";
import { type Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaTables } from "@langwatch/prisma-client/ownership";

import type { DatasetRecordRepository } from "../dataset-record.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
type DatasetRecordDatabase = Pick<PrismaClient, "datasetRecord" | "$queryRaw">;

/**
 * Declared rather than inherited from `PrismaRepository.for`: the ordered reads
 * are SQL, and the model-scoped client that base class hands over has no
 * `$queryRaw`. Prisma cannot sort by `id COLLATE "C"`, so the order is written here.
 */
export class PrismaDatasetRecordRepository implements DatasetRecordRepository {
  static readonly tables = prismaTables("DatasetRecord");

  static create({ prisma }: { prisma: DatasetRecordDatabase }): PrismaDatasetRecordRepository {
    return new PrismaDatasetRecordRepository(prisma);
  }

  private constructor(private readonly database: DatasetRecordDatabase) {}

  async count(input: { datasetId: string; projectId: string }): Promise<number> {
    return this.database.datasetRecord.count({ where: input });
  }

  async countByDataset(input: {
    projectId: string;
    datasetIds: readonly string[];
  }): Promise<{ datasetId: string; recordCount: number }[]> {
    if (input.datasetIds.length === 0) return [];
    const grouped = await this.database.datasetRecord.groupBy({
      by: ["datasetId"],
      where: { projectId: input.projectId, datasetId: { in: [...input.datasetIds] } },
      _count: { _all: true },
    });
    return grouped.map((row) => ({ datasetId: row.datasetId, recordCount: row._count._all }));
  }

  async findPage(input: {
    datasetId: string;
    projectId: string;
    limit: number;
    cursorId?: string;
  }): Promise<DatasetRecord[]> {
    const cursorId = input.cursorId ?? null;
    const rows = await this.database.$queryRaw<unknown[]>`
      SELECT "id", "datasetId", "projectId", "entry", "createdAt", "updatedAt"
        FROM "DatasetRecord"
       WHERE "datasetId" = ${input.datasetId}
         AND "projectId" = ${input.projectId}
         AND (${cursorId}::text IS NULL OR ("createdAt", "id" COLLATE "C") > (
               SELECT "createdAt", "id" COLLATE "C"
                 FROM "DatasetRecord"
                WHERE "id" = ${cursorId}
                  AND "datasetId" = ${input.datasetId}
                  AND "projectId" = ${input.projectId}
             ))
       ORDER BY "createdAt" ASC, "id" COLLATE "C" ASC
       LIMIT ${input.limit}
    `;
    return rows.map(toDatasetRecord);
  }

  async findByIds(input: {
    datasetId: string;
    projectId: string;
    ids: readonly string[];
  }): Promise<DatasetRecord[]> {
    if (input.ids.length === 0) return [];
    const rows = await this.database.datasetRecord.findMany({
      where: { datasetId: input.datasetId, projectId: input.projectId, id: { in: [...input.ids] } },
    });
    return rows.map(toDatasetRecord);
  }

  async listAll(input: {
    datasetId: string;
    projectId: string;
    page: number;
    limit: number;
  }): Promise<{ records: DatasetRecord[]; total: number }> {
    const where = { datasetId: input.datasetId, projectId: input.projectId };
    const [rows, total] = await Promise.all([
      this.database.$queryRaw<unknown[]>`
        SELECT "id", "datasetId", "projectId", "entry", "createdAt", "updatedAt"
          FROM "DatasetRecord"
         WHERE "datasetId" = ${input.datasetId}
           AND "projectId" = ${input.projectId}
         ORDER BY "createdAt" ASC, "id" COLLATE "C" ASC
         LIMIT ${input.limit} OFFSET ${(input.page - 1) * input.limit}
      `,
      this.database.datasetRecord.count({ where }),
    ]);
    return { records: rows.map(toDatasetRecord), total };
  }

  async createMany(input: {
    datasetId: string;
    projectId: string;
    entries: (DatasetRecordInput & { id: string })[];
  }): Promise<DatasetRecord[]> {
    await this.database.datasetRecord.createMany({
      data: input.entries.map(({ id, ...entry }) => ({
        id,
        datasetId: input.datasetId,
        projectId: input.projectId,
        entry: entry as Prisma.InputJsonValue,
      })),
    });
    const rows = await this.database.$queryRaw<unknown[]>`
      SELECT "id", "datasetId", "projectId", "entry", "createdAt", "updatedAt"
        FROM "DatasetRecord"
       WHERE "datasetId" = ${input.datasetId}
         AND "projectId" = ${input.projectId}
         AND "id" = ANY(${input.entries.map((entry) => entry.id)}::text[])
       ORDER BY "createdAt" ASC, "id" COLLATE "C" ASC
    `;
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
    if (changed.count === 0) throw new DatasetRecordNotFoundError();
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
