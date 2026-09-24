import {
  type BatchEvaluationRecord,
  type BatchEvaluationSummary,
  DatasetNotFoundError,
} from "@langwatch/dataset-contract";

import type { BatchEvaluationRepository } from "../batch-evaluation.repository.ts";
import type { DatasetRow } from "../dataset.repository.ts";
import {
  type MemoryDatasetDatabase,
  type MemoryBatchEvaluation,
} from "./memory.dataset.database.ts";

export class MemoryBatchEvaluationRepository implements BatchEvaluationRepository {
  #database: MemoryDatasetDatabase;

  private constructor(database: MemoryDatasetDatabase) {
    this.#database = database;
  }

  static create(
    input: Readonly<{ database: MemoryDatasetDatabase }>,
  ): MemoryBatchEvaluationRepository {
    return new MemoryBatchEvaluationRepository(input.database);
  }

  async summariseByExperiment(input: { projectId: string }): Promise<BatchEvaluationSummary[]> {
    const groups = new Map<string, MemoryBatchEvaluation[]>();

    for (const row of this.#of(input.projectId)) {
      const key = `${row.experimentId}${row.datasetSlug}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    return [...groups.values()].map((rows) => ({
      experimentId: rows[0]!.experimentId,
      datasetSlug: rows[0]!.datasetSlug,
      _count: { experimentId: rows.length },
      _sum: { cost: rows.reduce((total, row) => total + row.cost, 0) },
      _avg: { score: rows.reduce((total, row) => total + row.score, 0) / rows.length },
    }));
  }

  async findAllByExperiment(input: {
    projectId: string;
    experimentId: string;
  }): Promise<BatchEvaluationRecord[]> {
    return this.#of(input.projectId)
      .filter((row) => row.experimentId === input.experimentId)
      .map((row) => ({
        ...row,
        dataset: this.#dataset(row),
      }));
  }

  #of(projectId: string): MemoryBatchEvaluation[] {
    return this.#database.batchEvaluations().filter((row) => row.projectId === projectId);
  }

  /** The dataset the run was against, as the relational read includes it. */
  #dataset(row: MemoryBatchEvaluation): { id: string; name: string; slug: string } {
    let dataset: DatasetRow;
    try {
      dataset = this.#database.getDataset(row.projectId, row.datasetId);
    } catch (error) {
      if (error instanceof DatasetNotFoundError)
        throw new Error(`No Dataset found for id ${row.datasetId}`);
      throw error;
    }

    return { id: dataset.id, name: dataset.name, slug: dataset.slug };
  }
}
