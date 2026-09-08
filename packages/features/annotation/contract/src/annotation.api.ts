import { featureApi } from "@langwatch/runtime-composition/contract";
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
import type {
  AnnotationScore,
  AnnotationScoreName,
  UpsertAnnotationScoreInput,
} from "./annotation-score.schemas.ts";
import type { AnnotationQueueItem, AnnotationQueueListedItem } from "./annotation-queue.schemas.ts";
import type {
  AnnotationQueueDetail,
  AnnotationQueueListEntry,
  AnnotationQueuePendingCount,
  AnnotationQueueRecord,
} from "./annotation-response.schemas.ts";
import type {
  AnnotationQueueCaller,
  AnnotationQueueConfiguration,
  AnnotationQueueScope,
  QueueAnnotationTracesInput,
} from "./annotation-queue.types.ts";
import type {
  AnnotationOptimizedQueues,
  AnnotationQueueItemWithTrace,
  AnnotationWithFullUser,
  AnnotationWithUserSummary,
} from "./annotation-review.schemas.ts";
import type {
  AnnotationReviewCreateInput,
  AnnotationReviewDeleteInput,
  AnnotationReviewOptimizedQueuesInput,
  AnnotationReviewUpdateInput,
} from "./annotation-review.types.ts";
import type { CreateUnattributedAnnotationInput } from "./annotation-rest.schemas.ts";

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
}

export const AnnotationApi = featureApi<AnnotationApi>("annotation");
