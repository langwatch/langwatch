import type { DatasetStorage } from "../ports/dataset-storage.port";
import { DatasetRecordContentRepository } from "../repositories/prisma/dataset-record-content.repository";
import { withDatasetLock as runWithDatasetLock } from "./dataset-lock";
import { StreamingChunkWriter } from "./dataset-chunk-writer";

type DatasetDatabase = Parameters<typeof DatasetRecordContentRepository.create>[0];

export type DatasetMigrationRecord = { id: string; entry: unknown };

export type DatasetMigrationTransaction = Parameters<
  Parameters<typeof runWithDatasetLock>[1]
>[0];

export interface DatasetMigrationRepository {
  findDatasetRecordsPage(input: {
    datasetId: string;
    projectId: string;
    take: number;
    cursorId?: string;
  }): Promise<DatasetMigrationRecord[]>;
  countAndMaxUpdatedAt(
    input: {
      datasetId: string;
      projectId: string;
    },
    options?: { tx?: DatasetMigrationTransaction },
  ): Promise<{
    count: number;
    maxUpdatedAt: Date | null;
  }>;
}

/**
 * Owns the private persistence, lock and chunk-writer details of dataset
 * migrations. Tasks consume this class rather than importing Prisma
 * repositories or storage helpers from the feature implementation.
 */
export class DatasetMigrationService implements DatasetMigrationRepository {
  private readonly records: DatasetRecordContentRepository;

  private constructor(private readonly database: DatasetDatabase) {
    this.records = DatasetRecordContentRepository.create(database);
  }

  static create(database: DatasetDatabase): DatasetMigrationService {
    return new DatasetMigrationService(database);
  }

  findDatasetRecordsPage(input: {
    datasetId: string;
    projectId: string;
    take: number;
    cursorId?: string;
  }): Promise<DatasetMigrationRecord[]> {
    return this.records.findDatasetRecordsPage(input);
  }

  countAndMaxUpdatedAt(
    input: {
      datasetId: string;
      projectId: string;
    },
    options?: { tx?: DatasetMigrationTransaction },
  ): Promise<{
    count: number;
    maxUpdatedAt: Date | null;
  }> {
    return this.records.countAndMaxUpdatedAt(input, {
      tx: options?.tx,
    });
  }

  async writeDatasetChunks(input: {
    storage: DatasetStorage;
    projectId: string;
    datasetId: string;
    readPage: (cursorId?: string) => Promise<DatasetMigrationRecord[]>;
  }): Promise<{
    rowCount: number;
    sizeBytes: number;
    chunkCount: number;
    chunkOffsets: Array<{
      index: number;
      startRow: number;
      endRow: number;
      byteSize: number;
    }>;
  }> {
    return DatasetMigrationService.writeDatasetChunks(input);
  }

  static async writeDatasetChunks(input: {
    storage: DatasetStorage;
    projectId: string;
    datasetId: string;
    readPage: (cursorId?: string) => Promise<DatasetMigrationRecord[]>;
  }): Promise<{
    rowCount: number;
    sizeBytes: number;
    chunkCount: number;
    chunkOffsets: Array<{
      index: number;
      startRow: number;
      endRow: number;
      byteSize: number;
    }>;
  }> {
    const writer = new StreamingChunkWriter({
      storage: input.storage,
      projectId: input.projectId,
      datasetId: input.datasetId,
    });
    let cursorId: string | undefined;
    for (;;) {
      const page = await input.readPage(cursorId);
      if (page.length === 0) break;
      for (const row of page) {
        await writer.push(row.entry, { id: row.id });
      }
      cursorId = page[page.length - 1]!.id;
    }
    return writer.finalize();
  }

  withDatasetLock<T>(
    datasetId: string,
    fn: (transaction: DatasetMigrationTransaction) => Promise<T>,
  ): Promise<T> {
    return DatasetMigrationService.withDatasetLock(this.database, datasetId, fn);
  }

  static withDatasetLock<T>(
    database: DatasetDatabase,
    datasetId: string,
    fn: (transaction: DatasetMigrationTransaction) => Promise<T>,
  ): Promise<T> {
    return runWithDatasetLock({ prisma: database, datasetId }, (transaction) =>
      fn(transaction),
    );
  }
}
