import type { AnnotationRepositories } from "../annotation.repositories.ts";
import { MemoryAnnotationQueueItemRepository } from "./memory.annotation-queue-item.repository.ts";
import { MemoryAnnotationQueueDatabase } from "./memory.annotation-queue.database.ts";
import { MemoryAnnotationQueueRepository } from "./memory.annotation-queue.repository.ts";
import { MemoryAnnotationScoreRepository } from "./memory.annotation-score.repository.ts";
import { MemoryAnnotationUsageRepository } from "./memory.annotation-usage.repository.ts";
import { MemoryAnnotationRepository } from "./memory.annotation.repository.ts";

export class MemoryAnnotationRepositories {
  static readonly requires = [] as const;

  static create(): AnnotationRepositories {
    const database = MemoryAnnotationQueueDatabase.create();

    const annotations = MemoryAnnotationRepository.create();

    return {
      annotations,
      scores: MemoryAnnotationScoreRepository.create({ memory: database }),
      queues: MemoryAnnotationQueueRepository.create({ database }),
      queueItems: MemoryAnnotationQueueItemRepository.create({ memory: database }),
      usage: MemoryAnnotationUsageRepository.create({ annotations, database }),
    };
  }
}
