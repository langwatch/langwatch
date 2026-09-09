import { z } from "zod";
import {
  annotationQueueRecordSchema,
  annotationQueueDetailSchema,
} from "./annotation-response.schemas.ts";
import { annotationUserSchema } from "./annotation.schemas.ts";

/** Which items a queue view shows; `all` is both pending and completed. */
export const annotationQueueItemStatusSchema = z.enum(["pending", "completed", "all"]);
export type AnnotationQueueItemStatus = z.infer<typeof annotationQueueItemStatusSchema>;

export const annotationQueueItemSchema = z.object({
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
const annotationQueueItemWithReviewerSchema = z.object({
  ...annotationQueueItemSchema.shape,
  user: annotationUserSchema.nullable(),
  createdByUser: annotationUserSchema.nullable(),
});
export const annotationQueueListedItemSchema = z.object({
  ...annotationQueueItemWithReviewerSchema.shape,
  annotationQueue: z
    .object({
      ...annotationQueueRecordSchema.shape,
      members: z.array(z.object({ annotationQueueId: z.string(), userId: z.string() })),
    })
    .nullable(),
});
export const annotationQueuePageItemSchema = z.object({
  ...annotationQueueItemWithReviewerSchema.shape,
  annotationQueue: annotationQueueDetailSchema.nullable(),
});
export const annotationQueueWithItemsSchema = z.object({
  ...annotationQueueDetailSchema.shape,
  AnnotationQueueItems: z.array(
    z.object({
      ...annotationQueueItemSchema.shape,
      user: annotationUserSchema.nullable(),
      annotationQueue: annotationQueueRecordSchema.nullable(),
    }),
  ),
});
export type AnnotationQueueItem = z.infer<typeof annotationQueueItemSchema>;
export type AnnotationQueueListedItem = z.infer<typeof annotationQueueListedItemSchema>;
export type AnnotationQueuePageItem = z.infer<typeof annotationQueuePageItemSchema>;
export type AnnotationQueueWithItems = z.infer<typeof annotationQueueWithItemsSchema>;
