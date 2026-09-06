/**
 * What the annotation tRPC surface answers with.
 *
 * Every shape here is the one the procedures already returned; nothing is
 * reshaped. The queue rows are the store's, declared in `annotation.queue.ts`
 * and mirrored here as parsers so a declared output can name them.
 */
import { userFullProfileSchema } from "@langwatch/user-contract";
import { z } from "zod";
import { annotationSchema, annotationUserSchema } from "./annotation.record";

/** One comment beside the person who left it, as a trace's list renders it. */
export const annotationWithUserSummarySchema = annotationSchema.extend({
  user: annotationUserSchema.nullable(),
});

/** The same, with the full profile the project's annotations list renders. */
export const annotationWithFullUserSchema = annotationSchema.extend({
  user: userFullProfileSchema.nullable(),
});

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

/** A queue in the picker: enough to name it and to link to it. */
export const annotationQueueListEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});

/** A person on a queue, as the member avatars render them. */
export const annotationQueueMemberViewSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string().nullable(),
    image: z.string().nullable(),
  }),
});

/** A score type attached to a queue, as the picker lists it. */
export const annotationQueueScoreViewSchema = z.object({
  annotationScore: z.object({ id: z.string(), name: z.string() }),
});

/** One queue with the two lists the drawer and the queue page render. */
export const annotationQueueDetailSchema = annotationQueueRecordSchema.extend({
  members: z.array(annotationQueueMemberViewSchema),
  AnnotationQueueScores: z.array(annotationQueueScoreViewSchema),
});

/** A queue and how much is still open in it, for the reviewer's own strip. */
export const annotationQueuePendingCountSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  pendingCount: z.number(),
});

/** How many queue items a removal took out. */
export const annotationQueueItemsDeletedSchema = z.object({ deleted: z.number() });
