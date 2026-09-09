import { datasetRecordSchema, type DatasetRecord } from "@langwatch/dataset-contract";

import type { DatasetRecordContentRepository } from "../dataset-record-content.repository.ts";
import { MemoryDatasetDatabase } from "./memory.dataset.database.ts";

export class MemoryDatasetRecordContentRepository implements DatasetRecordContentRepository {
  #database: MemoryDatasetDatabase;

  private constructor(database: MemoryDatasetDatabase) {
    this.#database = database;
  }

  static create(
    input: Readonly<{ database: MemoryDatasetDatabase }>,
  ): MemoryDatasetRecordContentRepository {
    return new MemoryDatasetRecordContentRepository(input.database);
  }

  async createMany(input: {
    records: Array<{ id: string; entry: unknown }>;
    datasetId: string;
    projectId: string;
  }): Promise<DatasetRecord[]> {
    const now = this.#database.now();

    return input.records.map((record) => {
      const stored = datasetRecordSchema.parse({
        id: record.id,
        datasetId: input.datasetId,
        projectId: input.projectId,
        entry: record.entry,
        createdAt: now,
        updatedAt: now,
      });

      this.#database.putRecord(stored);

      return structuredClone(stored);
    });
  }
}
