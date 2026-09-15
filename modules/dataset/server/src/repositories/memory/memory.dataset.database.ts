import type { DatasetRecord } from "@langwatch/dataset-contract";
import { nowInstant, toDate } from "@langwatch/time";

import type { DatasetRow } from "../dataset.repository.ts";

/** A stored batch-evaluation row, as the memory twin keeps it. */
export type MemoryBatchEvaluation = {
  id: string;
  experimentId: string;
  projectId: string;
  data: unknown;
  status: string;
  score: number;
  label: string | null;
  passed: boolean;
  details: string;
  cost: number;
  datasetSlug: string;
  datasetId: string;
  evaluation: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * The rows the five memory repositories share. They read each other's state —
 * a dataset's record count is the records this holds — so one database backs
 * all of them, exactly as one schema backs the five Prisma ones.
 */
export class MemoryDatasetDatabase {
  #datasets: DatasetRow[] = [];
  #records: DatasetRecord[] = [];
  #batchEvaluations: MemoryBatchEvaluation[] = [];

  static create(): MemoryDatasetDatabase {
    return new MemoryDatasetDatabase();
  }

  datasets(): DatasetRow[] {
    return this.#datasets;
  }

  dataset(projectId: string, id: string): DatasetRow | undefined {
    return this.#datasets.find((row) => row.projectId === projectId && row.id === id);
  }

  putDataset(row: DatasetRow): void {
    const index = this.#datasets.findIndex(
      (stored) => stored.projectId === row.projectId && stored.id === row.id,
    );

    if (index === -1) this.#datasets.push(row);
    else this.#datasets[index] = row;
  }

  removeDataset(projectId: string, id: string): boolean {
    const index = this.#datasets.findIndex(
      (row) => row.projectId === projectId && row.id === id,
    );
    if (index === -1) return false;

    this.#datasets.splice(index, 1);

    return true;
  }

  records(): DatasetRecord[] {
    return this.#records;
  }

  putRecord(record: DatasetRecord): void {
    const index = this.#records.findIndex(
      (stored) => stored.projectId === record.projectId && stored.id === record.id,
    );

    if (index === -1) this.#records.push(record);
    else this.#records[index] = record;
  }

  removeRecords(input: {
    projectId: string;
    datasetId: string;
    recordIds: readonly string[];
  }): number {
    const remaining = this.#records.filter(
      (record) =>
        !(
          record.projectId === input.projectId &&
          record.datasetId === input.datasetId &&
          input.recordIds.includes(record.id)
        ),
    );
    const removed = this.#records.length - remaining.length;
    this.#records = remaining;

    return removed;
  }

  batchEvaluations(): MemoryBatchEvaluation[] {
    return this.#batchEvaluations;
  }

  putBatchEvaluation(row: MemoryBatchEvaluation): void {
    this.#batchEvaluations.push(row);
  }

  /** The clock every write here stamps with, so two twins agree on "now". */
  now(): Date {
    return toDate(nowInstant());
  }
}
