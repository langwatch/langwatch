import type { AnnotationRepository } from "./annotation.repository.ts";
import type { AnnotationScoreRepository } from "./annotation-score.repository.ts";
import type { AnnotationQueueRepository } from "./annotation-queue.repository.ts";
import type { AnnotationQueueItemRepository } from "./annotation-queue-item.repository.ts";

export interface AnnotationRepositories {
  readonly annotations: AnnotationRepository;
  readonly scores: AnnotationScoreRepository;
  readonly queues: AnnotationQueueRepository;
  readonly queueItems: AnnotationQueueItemRepository;
}
