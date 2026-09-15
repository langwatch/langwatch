import { traceSchema } from "@langwatch/trace-contract";
import { z } from "zod";
import {
  annotationQueueListedItemSchema,
  annotationQueuePageItemSchema,
} from "./annotation-queue.schemas.ts";
import {
  annotationQueueDetailSchema,
  annotationWithFullUserSchema,
  annotationWithUserSummarySchema,
} from "./annotation-response.schemas.ts";

export type AnnotationWithFullUser = z.infer<typeof annotationWithFullUserSchema>;
export type AnnotationWithUserSummary = z.infer<typeof annotationWithUserSummarySchema>;
export const annotationQueueItemWithTraceSchema = z.object({
  ...annotationQueueListedItemSchema.shape,
  trace: traceSchema.nullable(),
});
export const annotationReviewQueueItemSchema = z.object({
  ...annotationQueuePageItemSchema.shape,
  trace: traceSchema.nullable(),
  annotations: annotationWithFullUserSchema.array(),
  scoreOptions: z.array(z.string()),
});
export const annotationReviewQueueSchema = z.object({
  ...annotationQueueDetailSchema.shape,
  AnnotationQueueItems: annotationReviewQueueItemSchema.array(),
});
export const annotationOptimizedQueuesSchema = z.object({
  assignedQueueItems: annotationReviewQueueItemSchema.array(),
  queues: annotationReviewQueueSchema.array(),
  totalCount: z.number(),
});
export type AnnotationQueueItemWithTrace = z.infer<typeof annotationQueueItemWithTraceSchema>;
export type AnnotationReviewQueueItem = z.infer<typeof annotationReviewQueueItemSchema>;
export type AnnotationReviewQueue = z.infer<typeof annotationReviewQueueSchema>;
export type AnnotationOptimizedQueues = z.infer<typeof annotationOptimizedQueuesSchema>;
