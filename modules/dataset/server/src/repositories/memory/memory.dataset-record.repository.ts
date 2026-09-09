import {
  datasetRecordSchema,
  DatasetRecordNotFoundError,
  type DatasetRecord,
  type DatasetRecordInput,
} from "@langwatch/dataset-contract";

import type { DatasetRecordRepository } from "../dataset-record.repository.ts";
import { MemoryDatasetDatabase } from "./memory.dataset.database.ts";

/** `[createdAt asc, id asc]`, the canonical order every read path uses. */
function canonical(left: DatasetRecord, right: DatasetRecord): number {
  return left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id);
}

export class MemoryDatasetRecordRepository implements DatasetRecordRepository {
  #database: MemoryDatasetDatabase;

  private constructor(database: MemoryDatasetDatabase) {
    this.#database = database;
  }

  static create(
    input: Readonly<{ database: MemoryDatasetDatabase }>,
  ): MemoryDatasetRecordRepository {
    return new MemoryDatasetRecordRepository(input.database);
  }

  async list(input: {
    datasetId: string;
    projectId: string;
    page: number;
    limit: number;
  }): Promise<{ records: DatasetRecord[]; total: number }> {
    const matching = this.#of(input);

    return {
      records: matching
        .sort(canonical)
        .slice((input.page - 1) * input.limit, input.page * input.limit)
        .map((record) => structuredClone(record)),
      total: matching.length,
    };
  }

  async createMany(input: {
    datasetId: string;
    projectId: string;
    entries: Array<DatasetRecordInput & { id: string }>;
  }): Promise<DatasetRecord[]> {
    const now = this.#database.now();

    for (const entry of input.entries) {
      this.#database.putRecord(
        datasetRecordSchema.parse({
          id: entry.id,
          datasetId: input.datasetId,
          projectId: input.projectId,
          entry,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    const created = new Set(input.entries.map((entry) => entry.id));

    return this.#of(input)
      .filter((record) => created.has(record.id))
      .sort(canonical)
      .map((record) => structuredClone(record));
  }

  async update(input: {
    id: string;
    datasetId: string;
    projectId: string;
    entry: Record<string, unknown>;
  }): Promise<DatasetRecord> {
    const record = this.#of(input).find((candidate) => candidate.id === input.id);
    if (!record) throw new DatasetRecordNotFoundError();

    const updated = datasetRecordSchema.parse({
      ...record,
      entry: input.entry,
      updatedAt: this.#database.now(),
    });

    this.#database.putRecord(updated);

    return structuredClone(updated);
  }

  async deleteMany(input: {
    datasetId: string;
    projectId: string;
    recordIds: string[];
  }): Promise<number> {
    return this.#database.removeRecords(input);
  }

  #of(input: { datasetId: string; projectId: string }): DatasetRecord[] {
    return this.#database
      .records()
      .filter(
        (record) =>
          record.projectId === input.projectId && record.datasetId === input.datasetId,
      );
  }
}
