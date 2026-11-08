import {
  datasetColumnsSchema,
  datasetRecordSchema,
  DatasetRecordNotFoundError,
  type DatasetColumns,
  type DatasetRecord,
  type DatasetRecordInput,
} from "@langwatch/dataset-contract";
import { skipTenantCheck } from "@langwatch/prisma-client";
import { type Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaTables } from "@langwatch/prisma-client/ownership";

import { lockedView } from "../../rules/dataset-record-lock.rules.ts";
import type {
  DatasetRecordRepository,
  LockedDatasetRecords,
} from "../dataset-record.repository.ts";
import {
  DATASET_MUTATION_TXN_MAX_WAIT_MS,
  DATASET_MUTATION_TXN_TIMEOUT_MS,
} from "./prisma.dataset-content.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
type DatasetRecordDatabase = Pick<
  PrismaClient,
  "datasetRecord" | "dataset" | "$queryRaw" | "$executeRaw" | "$transaction"
>;
type DatasetRecordClient = Omit<DatasetRecordDatabase, "$transaction">;

/** Entries written per statement while a dataset's entries are replaced. */
const REPLACE_BATCH_SIZE = 500;
/** A replace writes up to one whole read of entries, so it gets the dataset mutation's time. */
const REPLACE_TXN_TIMEOUT_MS = 120_000;

/**
 * Declared rather than inherited from `PrismaRepository.for`: the ordered reads
 * are SQL, and the model-scoped client that base class hands over has no
 * `$queryRaw`. Prisma cannot sort by `id COLLATE "C"`, so the order is written here.
 */
export class PrismaDatasetRecordRepository implements DatasetRecordRepository {
  static readonly tables = prismaTables("DatasetRecord", "Dataset");

  static create({ prisma }: { prisma: DatasetRecordDatabase }): PrismaDatasetRecordRepository {
    return new PrismaDatasetRecordRepository(prisma, prisma);
  }

  private constructor(
    private readonly database: DatasetRecordClient,
    /** Absent on the instance bound to a lock's transaction. */
    private readonly root: DatasetRecordDatabase | null,
  ) {}

  async withDatasetLock<T>(
    input: { datasetId: string; projectId: string },
    work: (locked: LockedDatasetRecords) => Promise<T>,
  ): Promise<T> {
    if (!this.root) throw new Error("withDatasetLock cannot nest");
    return this.root.$transaction(
      async (client) => {
        await client.$executeRaw` ${skipTenantCheck({
          // Advisory-lock helper, key is dataset-bounded.
          SKIP_TENANT_CHECK: true,
        })}
SELECT pg_advisory_xact_lock(hashtextextended(${`dataset:${input.datasetId}`}, 0))`;
        const records = new PrismaDatasetRecordRepository(client, null);
        return work(lockedRecords({ records, client, ...input }));
      },
      { timeout: DATASET_MUTATION_TXN_TIMEOUT_MS, maxWait: DATASET_MUTATION_TXN_MAX_WAIT_MS },
    );
  }

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

  async replaceAll(input: {
    datasetId: string;
    projectId: string;
    entries: (DatasetRecordInput & { id: string })[];
  }): Promise<void> {
    if (!this.root) return replaceEntries({ client: this.database, ...input });
    await this.root.$transaction((client) => replaceEntries({ client, ...input }), {
      timeout: REPLACE_TXN_TIMEOUT_MS,
    });
  }
}

/** A lock-bound record repository plus the dataset row's columns, read and written in it. */
function lockedRecords({
  records,
  client,
  datasetId,
  projectId,
}: {
  records: PrismaDatasetRecordRepository;
  client: DatasetRecordClient;
  datasetId: string;
  projectId: string;
}): LockedDatasetRecords {
  return lockedView({
    records,
    columns: {
      columnTypes: async (): Promise<DatasetColumns> => {
        const row = await client.dataset.findFirstOrThrow({
          where: { id: datasetId, projectId },
          select: { columnTypes: true },
        });
        return datasetColumnsSchema.parse(row.columnTypes);
      },
      setColumnTypes: async (columnTypes: DatasetColumns): Promise<void> => {
        await client.dataset.updateMany({
          where: { id: datasetId, projectId },
          data: { columnTypes: columnTypes as Prisma.InputJsonValue },
        });
      },
    },
  });
}

/** Deletes the dataset's entries and writes these in their place, in the client's transaction. */
async function replaceEntries({
  client,
  datasetId,
  projectId,
  entries,
}: {
  client: DatasetRecordClient;
  datasetId: string;
  projectId: string;
  entries: (DatasetRecordInput & { id: string })[];
}): Promise<void> {
  const writtenAt = Date.now();
  await client.datasetRecord.deleteMany({ where: { datasetId, projectId } });
  for (let start = 0; start < entries.length; start += REPLACE_BATCH_SIZE) {
    await client.datasetRecord.createMany({
      data: entries.slice(start, start + REPLACE_BATCH_SIZE).map(({ id, ...entry }, offset) => {
        const createdAt = replacedAt({
          writtenAt,
          position: start + offset,
          count: entries.length,
        });
        return {
          id,
          datasetId,
          projectId,
          entry: entry as Prisma.InputJsonValue,
          createdAt,
          updatedAt: createdAt,
        };
      }),
    });
  }
}

/**
 * Reads order entries by `createdAt`: a replacement stamps its entries one millisecond apart in
 * the order given, ending before the write time, so an entry added after it still reads last.
 */
function replacedAt({
  writtenAt,
  position,
  count,
}: {
  writtenAt: number;
  position: number;
  count: number;
}): Date {
  return new Date(writtenAt - (count - position));
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
