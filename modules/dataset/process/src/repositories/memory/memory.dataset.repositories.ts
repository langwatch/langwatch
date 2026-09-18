import type { DatasetRepositories } from "../dataset.repositories.ts";
import { MemoryBatchEvaluationRepository } from "./memory.batch-evaluation.repository.ts";
import { MemoryDatasetContentRepository } from "./memory.dataset-content.repository.ts";
import { MemoryDatasetRecordContentRepository } from "./memory.dataset-record-content.repository.ts";
import { MemoryDatasetRecordRepository } from "./memory.dataset-record.repository.ts";
import { MemoryDatasetDatabase } from "./memory.dataset.database.ts";
import { MemoryDatasetRepository } from "./memory.dataset.repository.ts";

export class MemoryDatasetRepositories {
  static readonly requires = [] as const;

  static create(): DatasetRepositories {
    const database = MemoryDatasetDatabase.create();

    return {
      datasets: MemoryDatasetRepository.create({ database }),
      records: MemoryDatasetRecordRepository.create({ database }),
      content: MemoryDatasetContentRepository.create({ database }),
      recordContent: MemoryDatasetRecordContentRepository.create({ database }),
      batchEvaluations: MemoryBatchEvaluationRepository.create({ database }),
    };
  }
}
