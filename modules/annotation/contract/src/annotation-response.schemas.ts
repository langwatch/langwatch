import type { Named } from "@langwatch/module";
import { userFullProfileSchema } from "@langwatch/user-contract";
import { z } from "zod";

import { annotationScoreNameSchema } from "./annotation-score.schemas.ts";
import { annotationSchema, annotationUserSchema } from "./annotation.schemas.ts";

const annotationWithUserSummarySchemaDefinition = z
  .object({ ...annotationSchema.shape, user: annotationUserSchema.nullable() })
  .strict();
export interface AnnotationWithUserSummarySchema extends Named<
  typeof annotationWithUserSummarySchemaDefinition
> {}
export const annotationWithUserSummarySchema: AnnotationWithUserSummarySchema =
  annotationWithUserSummarySchemaDefinition;

const annotationWithFullUserSchemaDefinition = z
  .object({ ...annotationSchema.shape, user: userFullProfileSchema.nullable() })
  .strict();
export interface AnnotationWithFullUserSchema extends Named<
  typeof annotationWithFullUserSchemaDefinition
> {}
export const annotationWithFullUserSchema: AnnotationWithFullUserSchema =
  annotationWithFullUserSchemaDefinition;

/** One annotation queue, as its own row. */
const annotationQueueRecordSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  projectId: z.string(),
  description: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export interface AnnotationQueueRecordSchema extends Named<
  typeof annotationQueueRecordSchemaDefinition
> {}
export const annotationQueueRecordSchema: AnnotationQueueRecordSchema =
  annotationQueueRecordSchemaDefinition;

const annotationQueueListEntrySchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});
export interface AnnotationQueueListEntrySchema extends Named<
  typeof annotationQueueListEntrySchemaDefinition
> {}
export const annotationQueueListEntrySchema: AnnotationQueueListEntrySchema =
  annotationQueueListEntrySchemaDefinition;

const annotationQueueDetailSchemaDefinition = z.object({
  ...annotationQueueRecordSchema.shape,
  members: z.array(z.object({ user: annotationUserSchema })),
  AnnotationQueueScores: z.array(z.object({ annotationScore: annotationScoreNameSchema })),
});
export interface AnnotationQueueDetailSchema extends Named<
  typeof annotationQueueDetailSchemaDefinition
> {}
export const annotationQueueDetailSchema: AnnotationQueueDetailSchema =
  annotationQueueDetailSchemaDefinition;

const annotationQueuePendingCountSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  pendingCount: z.number(),
});
export interface AnnotationQueuePendingCountSchema extends Named<
  typeof annotationQueuePendingCountSchemaDefinition
> {}
export const annotationQueuePendingCountSchema: AnnotationQueuePendingCountSchema =
  annotationQueuePendingCountSchemaDefinition;

const annotationQueueItemsDeletedSchemaDefinition = z.object({ deleted: z.number() });
export interface AnnotationQueueItemsDeletedSchema extends Named<
  typeof annotationQueueItemsDeletedSchemaDefinition
> {}
export const annotationQueueItemsDeletedSchema: AnnotationQueueItemsDeletedSchema =
  annotationQueueItemsDeletedSchemaDefinition;

export type AnnotationQueueRecord = z.infer<typeof annotationQueueRecordSchema>;
export type AnnotationQueueListEntry = z.infer<typeof annotationQueueListEntrySchema>;
export type AnnotationQueueDetail = z.infer<typeof annotationQueueDetailSchema>;
export type AnnotationQueuePendingCount = z.infer<typeof annotationQueuePendingCountSchema>;
