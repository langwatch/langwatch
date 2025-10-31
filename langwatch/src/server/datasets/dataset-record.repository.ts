import {
  type PrismaClient,
  type DatasetRecord,
  type Prisma,
} from "@prisma/client";
import { nanoid } from "nanoid";
import * as Sentry from "@sentry/nextjs";
import { StorageService } from "../storage";
import type { DatasetRecordEntry } from "./types";

/**
 * Repository layer for dataset record data access.
 * Single Responsibility: Database operations for {@link DatasetRecord} entities.
 *
 * {@link DatasetRecord} represents individual rows/entries within a {@link Dataset}.
 */
export class DatasetRecordRepository {
  private readonly storageService: StorageService;

  constructor(private readonly prisma: PrismaClient) {
    this.storageService = new StorageService();
  }

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
    }
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
    }
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
      })
    );

    if (options?.tx) {
      await Promise.all(updatePromises);
    } else {
      await this.prisma.$transaction(updatePromises);
    }
  }

  /**
   * Creates multiple dataset records in batch.
   * Handles both S3-backed datasets (JSON file storage) and Prisma-backed datasets.
   * 
   * @param input - Dataset and record information
   * @param options - Optional transaction client to use
   */
  async batchCreate(
    input: {
      datasetId: string;
      projectId: string;
      datasetRecords: DatasetRecordEntry[];
      useS3: boolean;
    },
    options?: {
      tx?: Prisma.TransactionClient;
    }
  ): Promise<void> {
    const { datasetId, projectId, datasetRecords, useS3 } = input;
    const client = options?.tx ?? this.prisma;

    if (useS3) {
      const recordData = this.createRecordData(
        datasetRecords,
        { datasetId, projectId },
        true
      );

      let existingRecords: any[] = [];
      try {
        const { records: fetchedRecords } = await this.storageService.getObject(
          projectId,
          datasetId
        );
        existingRecords = fetchedRecords;
      } catch (error) {
        if ((error as any).name !== "NoSuchKey") {
          Sentry.captureException(error);
          throw error;
        }
      }

      const allRecords = [...existingRecords, ...recordData];

      await this.storageService.putObject(
        projectId,
        datasetId,
        JSON.stringify(allRecords)
      );

      await client.dataset.update({
        where: { id: datasetId, projectId },
        data: { s3RecordCount: allRecords.length },
      });
    } else {
      const recordData = this.createRecordData(datasetRecords, {
        datasetId,
        projectId,
      });

      await client.datasetRecord.createMany({
        data: recordData as (DatasetRecord & { entry: any })[],
      });
    }
  }

  /**
   * Helper method to format dataset records for storage.
   * @private
   */
  private createRecordData(
    entries: DatasetRecordEntry[],
    { datasetId, projectId }: { datasetId: string; projectId: string },
    useS3 = false
  ) {
    return entries.map((entry, index) => {
      const id = entry.id ?? nanoid();
      const entryWithoutId: Omit<typeof entry, "id"> = { ...entry };
      delete (entryWithoutId as any).id;

      const record = {
        id,
        entry: entryWithoutId,
        datasetId,
        createdAt: new Date(),
        updatedAt: new Date(),
        projectId,
      };

      if (useS3) {
        return {
          ...record,
          position: (index + 1) * 1000,
        };
      }

      return record;
    });
  }

  /**
   * Updates or creates a single dataset record.
   * 
   * @param input - Record update information
   * @param options - Optional transaction client
   */
  async upsert(
    input: {
      recordId: string;
      entry: any;
      datasetId: string;
      projectId: string;
      useS3: boolean;
    },
    options?: {
      tx?: Prisma.TransactionClient;
    }
  ): Promise<void> {
    const { recordId, entry, datasetId, projectId, useS3 } = input;
    const client = options?.tx ?? this.prisma;

    if (useS3) {
      const { records } = await this.storageService.getObject(projectId, datasetId);

      const recordIndex = records.findIndex(
        (record: any) => record.id === recordId
      );
      
      if (recordIndex === -1) {
        const newRecord = {
          id: recordId,
          entry,
          datasetId,
          projectId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        records.push(newRecord);
      } else {
        records[recordIndex] = {
          ...records[recordIndex],
          entry,
          updatedAt: new Date().toISOString(),
        };
      }

      await this.storageService.putObject(
        projectId,
        datasetId,
        JSON.stringify(records)
      );

      await client.dataset.update({
        where: { id: datasetId, projectId },
        data: { s3RecordCount: records.length },
      });
    } else {
      const record = await client.datasetRecord.findUnique({
        where: { id: recordId, projectId },
      });

      if (record) {
        await client.datasetRecord.update({
          where: { id: recordId, projectId },
          data: { entry },
        });
      } else {
        await client.datasetRecord.create({
          data: {
            id: recordId,
            entry,
            datasetId,
            projectId,
          },
        });
      }
    }
  }

  /**
   * Deletes multiple dataset records.
   * 
   * @param input - Record deletion information
   * @param options - Optional transaction client
   * @returns Number of deleted records
   */
  async batchDelete(
    input: {
      recordIds: string[];
      datasetId: string;
      projectId: string;
      useS3: boolean;
    },
    options?: {
      tx?: Prisma.TransactionClient;
    }
  ): Promise<{ deletedCount: number }> {
    const { recordIds, datasetId, projectId, useS3 } = input;
    const client = options?.tx ?? this.prisma;

    if (useS3) {
      let records: any[] = [];
      try {
        const { records: fetchedRecords } = await this.storageService.getObject(
          projectId,
          datasetId
        );
        records = fetchedRecords;
      } catch (error) {
        if ((error as any).name === "NoSuchKey") {
          return { deletedCount: 0 };
        }
        Sentry.captureException(error);
        throw error;
      }

      const initialLength = records.length;
      records = records.filter((record) => !recordIds.includes(record.id));

      if (records.length === initialLength) {
        return { deletedCount: 0 };
      }

      await this.storageService.putObject(
        projectId,
        datasetId,
        JSON.stringify(records)
      );

      await client.dataset.update({
        where: { id: datasetId, projectId },
        data: { s3RecordCount: records.length },
      });

      return { deletedCount: initialLength - records.length };
    } else {
      const { count } = await client.datasetRecord.deleteMany({
        where: {
          id: { in: recordIds },
          datasetId,
          projectId,
        },
      });

      return { deletedCount: count };
    }
  }
}

