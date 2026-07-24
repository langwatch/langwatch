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
   *
   * Ordered by `[createdAt asc, id asc]` to match every other PG read path
   * ({@link listPaginated}, the paginated/random reads in
   * `datasetRecord.utils.ts`). A stable, canonical order is required so the
   * PG→S3 backfill (which reads through here) writes chunks in the same row
   * order users saw pre-migration — preserving first/last/random/number
   * `entrySelection` parity — and so crash-resume re-runs produce identical
   * chunks. `id` is the tiebreaker for rows sharing a `createdAt`.
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
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  /**
   * Keyset-paginated read of a dataset's records, in the SAME canonical order as
   * {@link findDatasetRecords} (`[createdAt asc, id asc]`). Used by the PG→S3
   * backfill to stream a dataset into chunks WITHOUT loading every row into
   * memory — prod has multi-GB / million-row datasets that would OOM the
   * migration Job if slurped whole. Pass the previous page's last id as
   * `cursorId` to fetch the next page; `id` is the stable unique cursor and
   * `skip: 1` excludes the cursor row itself.
   */
  async findDatasetRecordsPage(input: {
    datasetId: string;
    projectId: string;
    take: number;
    cursorId?: string;
  }): Promise<DatasetRecord[]> {
    return await this.prisma.datasetRecord.findMany({
      where: {
        datasetId: input.datasetId,
        projectId: input.projectId,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: input.take,
      ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
    });
  }

  /**
   * Row count + latest `updatedAt` for a dataset's records, in ONE query.
   *
   * ADR-032: the PG→S3 backfill's concurrent-write guard. The migration reads
   * the records OUTSIDE the advisory lock (a snapshot), writes chunks, then
   * flips `contentLayout` UNDER the lock. A record insert/edit/delete in that
   * window would land in PG but never in the chunks → silently lost once reads
   * switch to S3. Comparing `(count, maxUpdatedAt)` from a baseline taken at
   * snapshot time against a re-read taken under the lock just before the flip
   * detects such a write (count catches insert/delete; `maxUpdatedAt` catches a
   * same-count content edit) so the flip can be skipped and re-tried next pass.
   *
   * Honest scope: this is a one-off-off-peak MITIGATION, not a hard guarantee —
   * the PG mutation paths don't take the advisory lock, so a write committing in
   * the narrow re-read→commit window is still missed. Off-peak the window is
   * effectively empty; a hard guarantee would require the writers on the lock.
   * Optionally pass `tx` so the re-read runs inside the flip transaction.
   */
  async countAndMaxUpdatedAt(
    input: { datasetId: string; projectId: string },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<{ count: number; maxUpdatedAt: Date | null }> {
    const client = options?.tx ?? this.prisma;
    const where = { datasetId: input.datasetId, projectId: input.projectId };
    const result = await client.datasetRecord.aggregate({
      where,
      _count: { _all: true },
      _max: { updatedAt: true },
    });
    return {
      count: result._count._all,
      maxUpdatedAt: result._max.updatedAt ?? null,
    };
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

  /**
   * Lists records for a dataset with pagination.
   */
  async listPaginated(input: {
    datasetId: string;
    projectId: string;
    skip: number;
    take: number;
  }): Promise<{ records: DatasetRecord[]; total: number }> {
    const where = {
      datasetId: input.datasetId,
      projectId: input.projectId,
    };

    const [records, total] = await Promise.all([
      this.prisma.datasetRecord.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: input.skip,
        take: input.take,
      }),
      this.prisma.datasetRecord.count({ where }),
    ]);

    return { records, total };
  }

  /**
   * Finds a single record by id within a dataset and project.
   */
  async findOne(input: {
    id: string;
    datasetId: string;
    projectId: string;
  }): Promise<DatasetRecord | null> {
    return await this.prisma.datasetRecord.findUnique({
      where: {
        id: input.id,
        projectId: input.projectId,
        datasetId: input.datasetId,
      },
    });
  }

  /**
   * Updates a single record's entry.
   */
  async updateEntry(input: {
    id: string;
    datasetId: string;
    projectId: string;
    entry: Prisma.InputJsonValue;
  }): Promise<DatasetRecord> {
    return await this.prisma.datasetRecord.update({
      where: {
        id: input.id,
        projectId: input.projectId,
        datasetId: input.datasetId,
      },
      data: { entry: input.entry },
    });
  }

  /**
   * Creates a new record.
   */
  async create(input: {
    id: string;
    datasetId: string;
    projectId: string;
    entry: Prisma.InputJsonValue;
  }): Promise<DatasetRecord> {
    return await this.prisma.datasetRecord.create({
      data: {
        id: input.id,
        entry: input.entry,
        datasetId: input.datasetId,
        projectId: input.projectId,
      },
    });
  }

  /**
   * Creates multiple records in a single batch operation.
   * Returns the created records with their generated timestamps.
   */
  async createMany(input: {
    records: Array<{
      id: string;
      entry: Prisma.InputJsonValue;
    }>;
    datasetId: string;
    projectId: string;
  }): Promise<DatasetRecord[]> {
    const data = input.records.map((record) => ({
      id: record.id,
      entry: record.entry,
      datasetId: input.datasetId,
      projectId: input.projectId,
    }));

    await this.prisma.datasetRecord.createMany({ data });

    // Fetch the created records to return full entities with timestamps
    return await this.prisma.datasetRecord.findMany({
      where: {
        id: { in: input.records.map((r) => r.id) },
        datasetId: input.datasetId,
        projectId: input.projectId,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Deletes records by IDs within a dataset and project.
   * Returns the count of deleted records.
   */
  async deleteMany(input: {
    recordIds: string[];
    datasetId: string;
    projectId: string;
  }): Promise<{ count: number }> {
    return await this.prisma.datasetRecord.deleteMany({
      where: {
        id: { in: input.recordIds },
        datasetId: input.datasetId,
        projectId: input.projectId,
      },
    });
  }
}
