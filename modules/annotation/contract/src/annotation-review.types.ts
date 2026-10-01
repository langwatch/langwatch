import type {
  AnnotationApiCreateInput,
  AnnotationApiOptimizedQueuesInput,
  AnnotationApiQueueWalkStepInput,
  AnnotationApiUpdateInput,
} from "./annotation-trpc.schemas.ts";

export type AnnotationReviewOptimizedQueuesInput = AnnotationApiOptimizedQueuesInput &
  Readonly<{ userId: string }>;
export type AnnotationReviewCreateInput = AnnotationApiCreateInput & Readonly<{ actorId: string }>;
export type AnnotationReviewUpdateInput = AnnotationApiUpdateInput & Readonly<{ actorId: string }>;
export type AnnotationReviewDeleteInput = Readonly<{ projectId: string; annotationId: string }>;
export type AnnotationQueueWalkStepInput = AnnotationApiQueueWalkStepInput &
  Readonly<{ userId: string }>;
