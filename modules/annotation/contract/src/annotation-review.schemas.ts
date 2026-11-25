import type { Named } from "@langwatch/module";
import { traceSchema } from "@langwatch/trace-contract";
import { z } from "zod";

import {
  annotationQueueListedItemSchema,
  annotationQueuePageItemSchema,
} from "./annotation-queue.schemas.ts";
import type { annotationWithUserSummarySchema } from "./annotation-response.schemas.ts";
import {
  annotationQueueDetailSchema,
  annotationWithFullUserSchema,
} from "./annotation-response.schemas.ts";
import type {
  AnnotationApiCreateInput,
  AnnotationApiOptimizedQueuesInput,
  AnnotationApiQueueWalkStepInput,
  AnnotationApiUpdateInput,
} from "./annotation-trpc.schemas.ts";

export type AnnotationWithFullUser = z.infer<typeof annotationWithFullUserSchema>;
export type AnnotationWithUserSummary = z.infer<typeof annotationWithUserSummarySchema>;
const annotationQueueItemWithTraceSchemaDefinition = z.object({
  ...annotationQueueListedItemSchema.shape,
  trace: traceSchema.nullable(),
});
export interface AnnotationQueueItemWithTraceSchema extends Named<
  typeof annotationQueueItemWithTraceSchemaDefinition
> {}
export const annotationQueueItemWithTraceSchema: AnnotationQueueItemWithTraceSchema =
  annotationQueueItemWithTraceSchemaDefinition;
const annotationReviewQueueItemSchemaDefinition = z.object({
  ...annotationQueuePageItemSchema.shape,
  trace: traceSchema.nullable(),
  annotations: annotationWithFullUserSchema.array(),
  scoreOptions: z.array(z.string()),
});
export interface AnnotationReviewQueueItemSchema extends Named<
  typeof annotationReviewQueueItemSchemaDefinition
> {}
export const annotationReviewQueueItemSchema: AnnotationReviewQueueItemSchema =
  annotationReviewQueueItemSchemaDefinition;
const annotationReviewQueueSchemaDefinition = z.object({
  ...annotationQueueDetailSchema.shape,
  AnnotationQueueItems: annotationReviewQueueItemSchema.array(),
});
export interface AnnotationReviewQueueSchema extends Named<
  typeof annotationReviewQueueSchemaDefinition
> {}
export const annotationReviewQueueSchema: AnnotationReviewQueueSchema =
  annotationReviewQueueSchemaDefinition;
const annotationOptimizedQueuesSchemaDefinition = z.object({
  assignedQueueItems: annotationReviewQueueItemSchema.array(),
  queues: annotationReviewQueueSchema.array(),
  totalCount: z.number(),
});
export interface AnnotationOptimizedQueuesSchema extends Named<
  typeof annotationOptimizedQueuesSchemaDefinition
> {}
export const annotationOptimizedQueuesSchema: AnnotationOptimizedQueuesSchema =
  annotationOptimizedQueuesSchemaDefinition;
/** One step of the reviewer's pending queue: the item, where it sits, and its neighbours. */
const annotationQueueWalkStepSchemaDefinition = z.object({
  item: annotationReviewQueueItemSchema.nullable(),
  position: z.number(),
  total: z.number(),
  previousItemId: z.string().nullable(),
  nextItemId: z.string().nullable(),
  queueFinished: z.boolean(),
});
export interface AnnotationQueueWalkStepSchema extends Named<
  typeof annotationQueueWalkStepSchemaDefinition
> {}
export const annotationQueueWalkStepSchema: AnnotationQueueWalkStepSchema =
  annotationQueueWalkStepSchemaDefinition;
export type AnnotationQueueItemWithTrace = z.infer<typeof annotationQueueItemWithTraceSchema>;
export type AnnotationReviewQueueItem = z.infer<typeof annotationReviewQueueItemSchema>;
export type AnnotationReviewQueue = z.infer<typeof annotationReviewQueueSchema>;
export type AnnotationOptimizedQueues = z.infer<typeof annotationOptimizedQueuesSchema>;
export type AnnotationQueueWalkStep = z.infer<typeof annotationQueueWalkStepSchema>;

export type AnnotationReviewOptimizedQueuesInput = AnnotationApiOptimizedQueuesInput &
  Readonly<{ userId: string }>;
export type AnnotationReviewCreateInput = AnnotationApiCreateInput & Readonly<{ actorId: string }>;
export type AnnotationReviewUpdateInput = AnnotationApiUpdateInput & Readonly<{ actorId: string }>;
export type AnnotationReviewDeleteInput = Readonly<{ projectId: string; annotationId: string }>;
export type AnnotationQueueWalkStepInput = AnnotationApiQueueWalkStepInput &
  Readonly<{ userId: string }>;
