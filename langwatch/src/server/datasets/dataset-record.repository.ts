import type { DatasetRecord, Prisma, PrismaClient } from "@prisma/client";

/**
 * Repository layer for dataset record data access.
 * Single Responsibility: Database operations for {@link DatasetRecord} entities.
 *
 * {@link DatasetRecord} represents individual rows/entries within a {@link Dataset}.
 */
export class DatasetRecordRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Finds all dataset records for a specific dataset.
   */
  async findDatasetRecords(
    input: {
      datasetId: string;
      projectId: string;
    },
    options?: {
      tx?: Prisma.TransactionClient;
    },
  ): Promise<DatasetRecord[]> {
    const client = options?.tx ?? this.prisma;
    return await client.datasetRecord.findMany({
      where: {
        datasetId: input.datasetId,
        projectId: input.projectId,
      },
    });
  }

  /**
   * Updates multiple dataset records atomically within a transaction.
   *
   * All records must belong to the same project (enforced by single projectId parameter).
   * Caller must ensure records belong to expected dataset/project before calling.
   *
   * @param projectId - The project all records belong to
   * @param updates - Array of records to update, where:
   *   - id: The unique identifier of the DatasetRecord to update
   *   - entry: The JSON data payload to store in the record
   * @param options - Optional transaction client to use
   */
  async updateDatasetRecordsTransaction(
    projectId: string,
    updates: Array<{
      id: string;
      entry: Prisma.InputJsonValue;
    }>,
    options?: {
      tx?: Prisma.TransactionClient;
    },
  ): Promise<void> {
    const client = options?.tx ?? this.prisma;

    const updatePromises = updates.map((update) =>
      client.datasetRecord.update({
        where: {
          id: update.id,
          projectId,
        },
        data: {
          entry: update.entry,
        },
      }),
    );

    if (options?.tx) {
      await Promise.all(updatePromises);
    } else {
      await this.prisma.$transaction(updatePromises);
    }
  }
}
