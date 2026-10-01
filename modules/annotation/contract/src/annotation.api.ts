import { moduleApi } from "@langwatch/kernel/module-api";

import type { AnnotationQueueItem, AnnotationQueueListedItem } from "./annotation-queue.schemas.ts";
import type {
  AnnotationQueueCaller,
  AnnotationQueueConfiguration,
  AnnotationQueueScope,
  QueueAnnotationTracesInput,
} from "./annotation-queue.types.ts";
import type {
  AnnotationQueueDetail,
  AnnotationQueueListEntry,
  AnnotationQueuePendingCount,
  AnnotationQueueRecord,
} from "./annotation-response.schemas.ts";
import type { CreateUnattributedAnnotationInput } from "./annotation-rest.schemas.ts";
import type {
  AnnotationOptimizedQueues,
  AnnotationQueueItemWithTrace,
  AnnotationQueueWalkStep,
  AnnotationWithFullUser,
  AnnotationWithUserSummary,
} from "./annotation-review.schemas.ts";
import type {
  AnnotationReviewCreateInput,
  AnnotationReviewDeleteInput,
  AnnotationReviewOptimizedQueuesInput,
  AnnotationQueueWalkStepInput,
  AnnotationReviewUpdateInput,
} from "./annotation-review.types.ts";
import type {
  AnnotationScore,
  AnnotationScoreName,
  UpsertAnnotationScoreInput,
} from "./annotation-score.schemas.ts";
import type {
  Annotation,
  AnnotationByIdInput,
  AnnotationScoreByIdInput,
  CreateAnnotationInput,
  DeleteAnnotationInput,
  ListAnnotationScoreNamesInput,
  ListAnnotationScoresInput,
  ListAnnotationsInput,
  ListProjectionAnnotationsInput,
  ProjectionAnnotation,
  ToggleAnnotationScoreInput,
  UpdateAnnotationInput,
} from "./annotation.schemas.ts";

/**
 * What the install-wide usage report counts here (ADR-156, section 10): how
 * many were made, since `since` where one is given, and when the first
 * annotation was. Times are epoch milliseconds.
 */
export interface AnnotationUsageCount {
  readonly annotations: number;
  readonly annotationQueues: number;
  readonly annotationQueueItems: number;
  readonly annotationScores: number;
  readonly firstAnnotationAt?: number;
}

/** Flat operations peers may call after the annotation app is composed. */
export interface AnnotationApi {
  create(input: CreateAnnotationInput): Promise<Annotation>;
  createUnattributed(input: CreateUnattributedAnnotationInput): Promise<Annotation>;
  createReview(input: AnnotationReviewCreateInput): Promise<Annotation>;
  update(input: UpdateAnnotationInput): Promise<Annotation>;
  updateReview(input: AnnotationReviewUpdateInput): Promise<Annotation>;
  delete(input: DeleteAnnotationInput): Promise<Annotation>;
  deleteReview(input: AnnotationReviewDeleteInput): Promise<Annotation>;
  getById(input: AnnotationByIdInput): Promise<Annotation>;
  list(input: ListAnnotationsInput): Promise<Annotation[]>;
  listWithFullUsers(input: ListAnnotationsInput): Promise<AnnotationWithFullUser[]>;
  listWithUserSummaries(input: ListAnnotationsInput): Promise<AnnotationWithUserSummary[]>;
  listReviewQueueItems(input: AnnotationQueueCaller): Promise<AnnotationQueueItemWithTrace[]>;
  listOptimizedQueues(
    input: AnnotationReviewOptimizedQueuesInput,
  ): Promise<AnnotationOptimizedQueues>;
  getQueueWalkStep(input: AnnotationQueueWalkStepInput): Promise<AnnotationQueueWalkStep>;
  listForProjection(input: ListProjectionAnnotationsInput): Promise<ProjectionAnnotation[]>;
  listScoreNames(input: ListAnnotationScoreNamesInput): Promise<AnnotationScoreName[]>;
  upsertScore(input: UpsertAnnotationScoreInput): Promise<AnnotationScore>;
  listScores(input: ListAnnotationScoresInput): Promise<AnnotationScore[]>;
  getScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore>;
  toggleScore(input: ToggleAnnotationScoreInput): Promise<AnnotationScore>;
  deleteScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore>;
  configure(input: AnnotationQueueConfiguration): Promise<AnnotationQueueRecord>;
  listQueues(
    input: AnnotationQueueScope & Readonly<{ reachableOnly?: boolean; userId?: string }>,
  ): Promise<AnnotationQueueListEntry[]>;
  getQueue(
    input: AnnotationQueueScope & Readonly<{ slug?: string; queueId?: string }>,
  ): Promise<AnnotationQueueDetail>;
  listQueueItems(input: AnnotationQueueScope): Promise<readonly AnnotationQueueListedItem[]>;
  countPendingItems(input: AnnotationQueueCaller): Promise<number>;
  countAssignedItems(input: AnnotationQueueCaller): Promise<number>;
  listMemberQueuePendingCounts(
    input: AnnotationQueueCaller,
  ): Promise<AnnotationQueuePendingCount[]>;
  deleteQueueItems(
    input: AnnotationQueueCaller & Readonly<{ queueItemIds: readonly string[] }>,
  ): Promise<number>;
  markQueueItemDone(
    input: AnnotationQueueCaller & Readonly<{ queueItemId: string }>,
  ): Promise<AnnotationQueueItem>;
  queueTraces(
    input: QueueAnnotationTracesInput,
  ): Promise<Readonly<{ created: number; skipped: number }>>;
  /** The usage report's figures for these projects. */
  countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<AnnotationUsageCount>;
}

export const AnnotationApi = moduleApi<AnnotationApi>()("annotation");
