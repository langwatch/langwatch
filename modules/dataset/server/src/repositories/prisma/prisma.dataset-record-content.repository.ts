import { datasetRecordSchema, type DatasetRecord } from "@langwatch/dataset-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

import type { DatasetRecordContentRepository } from "../dataset-record-content.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type DatasetRecordContentDatabase = Pick<PrismaClient, "datasetRecord">;

export class PrismaDatasetRecordContentRepository
  extends PrismaRepository.for("DatasetRecord")
  implements DatasetRecordContentRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaDatasetRecordContentRepository(prisma),
  );

  /**
   * Creates multiple records in one batch, then reads them back so the caller
   * gets full entities with the timestamps the database assigned.
   */
  async createMany(input: {
    records: Array<{ id: string; entry: unknown }>;
    datasetId: string;
    projectId: string;
  }): Promise<DatasetRecord[]> {
    const data = input.records.map((record) => ({
      id: record.id,
      entry: record.entry as Prisma.InputJsonValue,
      datasetId: input.datasetId,
      projectId: input.projectId,
    }));

    await this.prisma.datasetRecord.createMany({ data });

    const rows = await this.prisma.datasetRecord.findMany({
      where: {
        id: { in: input.records.map((record) => record.id) },
        datasetId: input.datasetId,
        projectId: input.projectId,
      },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((row) => datasetRecordSchema.parse(row));
  }
}
