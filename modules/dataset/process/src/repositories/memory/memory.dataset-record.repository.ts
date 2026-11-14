import {
  datasetColumnsSchema,
  datasetRecordSchema,
  type DatasetColumns,
  DatasetRecordNotFoundError,
  type DatasetRecord,
  type DatasetRecordInput,
} from "@langwatch/dataset-contract";
import { toDate } from "@langwatch/time";

import { lockedView } from "../../rules/dataset-record-lock.rules.ts";
import type {
  DatasetRecordRepository,
  LockedDatasetRecords,
} from "../dataset-record.repository.ts";
import type { MemoryDatasetDatabase } from "./memory.dataset.database.ts";

/** Ids compare by code unit, never by locale: Postgres matches it with COLLATE "C". */
function byCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** `[createdAt asc, id asc]`, the canonical order every read path uses. */
function canonical(left: DatasetRecord, right: DatasetRecord): number {
  return left.createdAt.getTime() - right.createdAt.getTime() || byCodeUnit(left.id, right.id);
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

  /** Each dataset's lock as the tail of the work queued on it. */
  #locks = new Map<string, Promise<unknown>>();

  async withDatasetLock<T>(
    input: { datasetId: string; projectId: string },
    work: (locked: LockedDatasetRecords) => Promise<T>,
  ): Promise<T> {
    const database = this.#database;
    const locked = lockedView({
      records: this,
      columns: {
        columnTypes: async (): Promise<DatasetColumns> =>
          datasetColumnsSchema.parse(
            database.getDataset(input.projectId, input.datasetId).columnTypes,
          ),
        setColumnTypes: async (columnTypes: DatasetColumns): Promise<void> => {
          const row = database.getDataset(input.projectId, input.datasetId);
          database.putDataset({ ...row, columnTypes });
        },
      },
    });
    const previous = this.#locks.get(input.datasetId) ?? Promise.resolve();
    const run = previous.then(
      () => work(locked),
      () => work(locked),
    );
    this.#locks.set(
      input.datasetId,
      run.catch(() => undefined),
    );
    return run;
  }

  async count(input: { datasetId: string; projectId: string }): Promise<number> {
    return this.#of(input).length;
  }

  async countByDataset(input: {
    projectId: string;
    datasetIds: readonly string[];
  }): Promise<{ datasetId: string; recordCount: number }[]> {
    return input.datasetIds
      .map((datasetId) => ({
        datasetId,
        recordCount: this.#of({ datasetId, projectId: input.projectId }).length,
      }))
      .filter(({ recordCount }) => recordCount > 0);
  }

  async findPage(input: {
    datasetId: string;
    projectId: string;
    limit: number;
    cursorId?: string;
  }): Promise<DatasetRecord[]> {
    const records = this.#of(input).toSorted(canonical);
    const cursorIndex = input.cursorId
      ? records.findIndex((record) => record.id === input.cursorId)
      : -1;
    // A cursor naming no entry of this dataset answers an empty page, as Postgres does.
    if (input.cursorId && cursorIndex === -1) return [];
    return records
      .slice(cursorIndex + 1, cursorIndex + 1 + input.limit)
      .map((record) => structuredClone(record));
  }

  async findByIds(input: {
    datasetId: string;
    projectId: string;
    ids: readonly string[];
  }): Promise<DatasetRecord[]> {
    const ids = new Set(input.ids);
    return this.#of(input)
      .filter((record) => ids.has(record.id))
      .map((record) => structuredClone(record));
  }

  async listAll(input: {
    datasetId: string;
    projectId: string;
    page: number;
    limit: number;
  }): Promise<{ records: DatasetRecord[]; total: number }> {
    const matching = this.#of(input);

    return {
      records: matching
        .toSorted(canonical)
        .slice((input.page - 1) * input.limit, input.page * input.limit)
        .map((record) => structuredClone(record)),
      total: matching.length,
    };
  }

  async createMany(input: {
    datasetId: string;
    projectId: string;
    entries: (DatasetRecordInput & { id: string })[];
  }): Promise<DatasetRecord[]> {
    const now = toDate(this.#database.now());

    for (const { id, ...entry } of input.entries) {
      this.#database.putRecord(
        datasetRecordSchema.parse({
          id,
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
      .toSorted(canonical)
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
      updatedAt: toDate(this.#database.now()),
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

  async replaceAll(input: {
    datasetId: string;
    projectId: string;
    entries: (DatasetRecordInput & { id: string })[];
  }): Promise<void> {
    const previous = this.#of(input);
    this.#database.removeRecords({ ...input, recordIds: previous.map((record) => record.id) });
    try {
      const ids = input.entries.map((entry) => entry.id);
      if (new Set(ids).size !== ids.length) throw new Error("Duplicate dataset record id");
      const writtenAt = this.#database.now();
      for (const [position, { id, ...entry }] of input.entries.entries()) {
        const createdAt = toDate(
          writtenAt.subtract({ milliseconds: input.entries.length - position }),
        );
        this.#database.putRecord(
          datasetRecordSchema.parse({
            id,
            datasetId: input.datasetId,
            projectId: input.projectId,
            entry,
            createdAt,
            updatedAt: createdAt,
          }),
        );
      }
    } catch (error) {
      const written = this.#of(input).map((record) => record.id);
      this.#database.removeRecords({ ...input, recordIds: written });
      for (const record of previous) this.#database.putRecord(record);
      throw error;
    }
  }

  #of(input: { datasetId: string; projectId: string }): DatasetRecord[] {
    return this.#database
      .records()
      .filter(
        (record) => record.projectId === input.projectId && record.datasetId === input.datasetId,
      );
  }
}
