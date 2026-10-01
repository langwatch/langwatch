import type { AnnotationQueueItemRepository } from "./annotation-queue-item.repository.ts";
import type { AnnotationQueueRepository } from "./annotation-queue.repository.ts";
import type { AnnotationScoreRepository } from "./annotation-score.repository.ts";
import type { AnnotationUsageRepository } from "./annotation-usage.repository.ts";
import type { AnnotationRepository } from "./annotation.repository.ts";

export interface AnnotationRepositories {
  readonly annotations: AnnotationRepository;
  readonly scores: AnnotationScoreRepository;
  readonly queues: AnnotationQueueRepository;
  readonly queueItems: AnnotationQueueItemRepository;
  /** The usage report's counts over the four tables above. */
  readonly usage: AnnotationUsageRepository;
}
