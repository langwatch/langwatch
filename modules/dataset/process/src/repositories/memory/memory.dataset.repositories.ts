import { memoryObjectStorage } from "@langwatch/process-stores";

import type { DatasetRepositories } from "../dataset.repositories.ts";
import { ObjectStorageDatasetChunkRepository } from "../object-storage/object-storage.dataset-chunk.repository.ts";
import { ObjectStorageDatasetSingleFileRepository } from "../object-storage/object-storage.dataset-single-file.repository.ts";
import { ObjectStorageDatasetVersionContentRepository } from "../object-storage/object-storage.dataset-version-content.repository.ts";
import { MemoryBatchEvaluationRepository } from "./memory.batch-evaluation.repository.ts";
import { MemoryDatasetContentRepository } from "./memory.dataset-content.repository.ts";
import { MemoryDatasetCountRepository } from "./memory.dataset-count.repository.ts";
import { MemoryDatasetMigrationRepository } from "./memory.dataset-migration.repository.ts";
import { MemoryDatasetRecordContentRepository } from "./memory.dataset-record-content.repository.ts";
import { MemoryDatasetRecordRepository } from "./memory.dataset-record.repository.ts";
import { MemoryDatasetVersionRepository } from "./memory.dataset-version.repository.ts";
import { MemoryDatasetDatabase } from "./memory.dataset.database.ts";
import { MemoryDatasetRepository } from "./memory.dataset.repository.ts";

export class MemoryDatasetRepositories {
  static readonly requires = [] as const;

  static create(): DatasetRepositories {
    const database = MemoryDatasetDatabase.create();
    const objectStorage = memoryObjectStorage();
    const chunks = ObjectStorageDatasetChunkRepository.create({ objectStorage });

    return {
      datasets: MemoryDatasetRepository.create({ database }),
      records: MemoryDatasetRecordRepository.create({ database }),
      content: MemoryDatasetContentRepository.create({ database }),
      recordContent: MemoryDatasetRecordContentRepository.create({ database }),
      batchEvaluations: MemoryBatchEvaluationRepository.create({ database }),
      count: MemoryDatasetCountRepository.create({ database }),
      migration: MemoryDatasetMigrationRepository.create(),
      chunks,
      migrationChunks: chunks,
      singleFiles: ObjectStorageDatasetSingleFileRepository.create({ objectStorage }),
      versions: MemoryDatasetVersionRepository.create(),
      versionContent: ObjectStorageDatasetVersionContentRepository.create({ objectStorage }),
    };
  }
}
