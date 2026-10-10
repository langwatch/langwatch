import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  annotationQueueRecordSchema,
  annotationQueueDetailSchema,
} from "./annotation-response.schemas.ts";
import { annotationUserSchema } from "./annotation.schemas.ts";

/** Which items a queue view shows; `all` is both pending and completed. */
export const annotationQueueItemStatusSchema = z.enum(["pending", "completed", "all"]);
export type AnnotationQueueItemStatus = z.infer<typeof annotationQueueItemStatusSchema>;

const annotationQueueItemSchemaDefinition = z.object({
  id: z.string(),
  annotationQueueId: z.string().nullable(),
  userId: z.string().nullable(),
  createdByUserId: z.string().nullable(),
  traceId: z.string(),
  projectId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  doneAt: z.date().nullable(),
  markedForDatasetAt: z.date().nullable(),
});
export interface AnnotationQueueItemSchema extends Named<
  typeof annotationQueueItemSchemaDefinition
> {}
export const annotationQueueItemSchema: AnnotationQueueItemSchema =
  annotationQueueItemSchemaDefinition;
const annotationQueueItemWithReviewerSchema = z.object({
  ...annotationQueueItemSchema.shape,
  user: annotationUserSchema.nullable(),
  createdByUser: annotationUserSchema.nullable(),
});
const annotationQueueListedItemSchemaDefinition = z.object({
  ...annotationQueueItemWithReviewerSchema.shape,
  annotationQueue: z
    .object({
      ...annotationQueueRecordSchema.shape,
      members: z.array(z.object({ annotationQueueId: z.string(), userId: z.string() })),
    })
    .nullable(),
});
export interface AnnotationQueueListedItemSchema extends Named<
  typeof annotationQueueListedItemSchemaDefinition
> {}
export const annotationQueueListedItemSchema: AnnotationQueueListedItemSchema =
  annotationQueueListedItemSchemaDefinition;
const annotationQueuePageItemSchemaDefinition = z.object({
  ...annotationQueueItemWithReviewerSchema.shape,
  annotationQueue: annotationQueueDetailSchema.nullable(),
});
export interface AnnotationQueuePageItemSchema extends Named<
  typeof annotationQueuePageItemSchemaDefinition
> {}
export const annotationQueuePageItemSchema: AnnotationQueuePageItemSchema =
  annotationQueuePageItemSchemaDefinition;
const annotationQueueWithItemsSchemaDefinition = z.object({
  ...annotationQueueDetailSchema.shape,
  AnnotationQueueItems: z.array(
    z.object({
      ...annotationQueueItemSchema.shape,
      user: annotationUserSchema.nullable(),
      annotationQueue: annotationQueueRecordSchema.nullable(),
    }),
  ),
});
export interface AnnotationQueueWithItemsSchema extends Named<
  typeof annotationQueueWithItemsSchemaDefinition
> {}
export const annotationQueueWithItemsSchema: AnnotationQueueWithItemsSchema =
  annotationQueueWithItemsSchemaDefinition;
export type AnnotationQueueItem = z.infer<typeof annotationQueueItemSchema>;
export type AnnotationQueueListedItem = z.infer<typeof annotationQueueListedItemSchema>;
export type AnnotationQueuePageItem = z.infer<typeof annotationQueuePageItemSchema>;
export type AnnotationQueueWithItems = z.infer<typeof annotationQueueWithItemsSchema>;

export type AnnotationQueueConfiguration = Readonly<{
  projectId: string;
  queueId?: string;
  name: string;
  description: string;
  userIds: readonly string[];
  scoreTypeIds: readonly string[];
}>;
export type AnnotationQueueScope = Readonly<{ projectId: string }>;
export type AnnotationQueueCaller = Readonly<{ projectId: string; userId: string }>;
export type QueueAnnotationTracesInput = AnnotationQueueCaller &
  Readonly<{
    traceIds: readonly string[];
    annotators: readonly string[];
  }>;
