import { userFullProfileSchema } from "@langwatch/user-contract";
import { z } from "zod";
import { annotationSchema, annotationUserSchema } from "./annotation.schemas.ts";
import { annotationScoreNameSchema } from "./annotation-score.schemas.ts";

export const annotationWithUserSummarySchema = z
  .object({ ...annotationSchema.shape, user: annotationUserSchema.nullable() })
  .strict();

export const annotationWithFullUserSchema = z
  .object({ ...annotationSchema.shape, user: userFullProfileSchema.nullable() })
  .strict();

/** One annotation queue, as its own row. */
export const annotationQueueRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  projectId: z.string(),
  description: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const annotationQueueListEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});

export const annotationQueueDetailSchema = z.object({
  ...annotationQueueRecordSchema.shape,
  members: z.array(z.object({ user: annotationUserSchema })),
  AnnotationQueueScores: z.array(z.object({ annotationScore: annotationScoreNameSchema })),
});

export const annotationQueuePendingCountSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  pendingCount: z.number(),
});

export const annotationQueueItemsDeletedSchema = z.object({ deleted: z.number() });

export type AnnotationQueueRecord = z.infer<typeof annotationQueueRecordSchema>;
export type AnnotationQueueListEntry = z.infer<typeof annotationQueueListEntrySchema>;
export type AnnotationQueueDetail = z.infer<typeof annotationQueueDetailSchema>;
export type AnnotationQueuePendingCount = z.infer<typeof annotationQueuePendingCountSchema>;
