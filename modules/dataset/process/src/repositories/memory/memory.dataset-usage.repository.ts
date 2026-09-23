import type { DatasetUsageCount } from "@langwatch/dataset-contract";

import type { DatasetUsageRepository } from "../dataset-usage.repository.ts";
import type { MemoryDatasetDatabase } from "./memory.dataset.database.ts";

export class MemoryDatasetUsageRepository implements DatasetUsageRepository {
  #database: MemoryDatasetDatabase;

  private constructor(database: MemoryDatasetDatabase) {
    this.#database = database;
  }

  static create(
    input: Readonly<{ database: MemoryDatasetDatabase }>,
  ): MemoryDatasetUsageRepository {
    return new MemoryDatasetUsageRepository(input.database);
  }

  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<DatasetUsageCount> {
    const inScope = (row: { projectId: string }) => projectIds.includes(row.projectId);
    const counted = (made: readonly number[]) =>
      made.filter((at) => since === undefined || at >= since).length;
    const firstOf = (made: readonly number[]) => (made.length === 0 ? [] : [Math.min(...made)]);

    const datasets = this.#database
      .datasets()
      .filter(inScope)
      .map((row) => row.createdAt.getTime());
    const evaluations = this.#database
      .batchEvaluations()
      .filter(inScope)
      .map((row) => row.createdAt.getTime());
    const records = this.#database
      .records()
      .filter(inScope)
      .map((row) => row.createdAt.getTime());
    const [firstDatasetAt] = firstOf(datasets);
    const [firstBatchEvaluationAt] = firstOf(evaluations);
    return {
      datasets: counted(datasets),
      datasetRecords: counted(records),
      batchEvaluations: counted(evaluations),
      ...(firstDatasetAt === undefined ? {} : { firstDatasetAt }),
      ...(firstBatchEvaluationAt === undefined ? {} : { firstBatchEvaluationAt }),
    };
  }
}
