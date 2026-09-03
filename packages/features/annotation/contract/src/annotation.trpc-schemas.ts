import { z } from "zod";
import {
  annotationAnchorColumnsSchema,
  annotationAnchorScopeSchema,
  refineAnnotationAnchorColumns,
} from "./annotation.anchor";
import { annotationScoreOptionSchema } from "./annotation.score";

/**
 * The transport inputs the annotation surface publishes.
 *
 * They live in the contract rather than beside the router for the same reason
 * the REST shapes do: the input a caller has to send is part of what this
 * feature promises, and a promise that only exists inside one router cannot be
 * read, reused or reviewed as a contract.
 */

/**
 * The scores carried on a comment, keyed by score-type id. The per-score shape
 * is the contract's own `annotationScoreOptionSchema`; the stored column shape
 * (`annotationScoreOptionsSchema`) is deliberately wider and is not this.
 */
export const annotationApiScoreOptionsSchema = z.record(z.string(), annotationScoreOptionSchema);
export type AnnotationApiScoreOptions = z.infer<typeof annotationApiScoreOptionsSchema>;

export const annotationApiCreateInputSchema = z
  .object({
    projectId: z.string(),
    comment: z.string().optional().nullable(),
    isThumbsUp: z.boolean().optional().nullable(),
    traceId: z.string(),
    scoreOptions: annotationApiScoreOptionsSchema,
    expectedOutput: z.string().optional().nullable(),
  })
  .merge(annotationAnchorColumnsSchema)
  .superRefine(refineAnnotationAnchorColumns);
export type AnnotationApiCreateInput = z.infer<typeof annotationApiCreateInputSchema>;

export const annotationApiUpdateInputSchema = z.object({
  id: z.string(),
  traceId: z.string(),
  projectId: z.string(),
  comment: z.string().optional().nullable(),
  isThumbsUp: z.boolean().optional().nullable(),
  expectedOutput: z.string().optional().nullable(),
  scoreOptions: annotationApiScoreOptionsSchema,
});
export type AnnotationApiUpdateInput = z.infer<typeof annotationApiUpdateInputSchema>;

export const annotationApiByTraceIdInputSchema = z.object({
  traceId: z.string(),
  projectId: z.string(),
  anchor: annotationAnchorScopeSchema.optional().default("all"),
});
export type AnnotationApiByTraceIdInput = z.infer<typeof annotationApiByTraceIdInputSchema>;

export const annotationApiByTraceIdsInputSchema = z.object({
  traceIds: z.array(z.string()),
  projectId: z.string(),
  anchor: annotationAnchorScopeSchema.optional().default("all"),
});
export type AnnotationApiByTraceIdsInput = z.infer<typeof annotationApiByTraceIdsInputSchema>;

export const annotationApiAnnotationScopeSchema = z.object({
  annotationId: z.string(),
  projectId: z.string(),
});
export type AnnotationApiAnnotationScope = z.infer<typeof annotationApiAnnotationScopeSchema>;

export const annotationApiProjectScopeSchema = z.object({ projectId: z.string() });

/**
 * A project scope that can also ask for only what this caller may already read.
 *
 * A picker built from every queue in the project offers ones the queue-item
 * read narrows straight back out, so choosing one empties the list and looks
 * broken. Callers that genuinely target any queue — adding a trace to one,
 * inviting people to one — leave `reachableOnly` off, which is why it is
 * opt-in rather than the default.
 */
export const annotationApiQueueListInputSchema = z.object({
  projectId: z.string(),
  reachableOnly: z.boolean().optional(),
});
export type AnnotationApiQueueListInput = z.infer<typeof annotationApiQueueListInputSchema>;
export type AnnotationApiProjectScope = z.infer<typeof annotationApiProjectScopeSchema>;

export const annotationApiListAllInputSchema = z.object({
  projectId: z.string(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});
export type AnnotationApiListAllInput = z.infer<typeof annotationApiListAllInputSchema>;

export const annotationApiQueueConfigurationInputSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  description: z.string(),
  userIds: z.array(z.string()),
  scoreTypeIds: z.array(z.string()),
  queueId: z.string().optional(),
});
export type AnnotationApiQueueConfigurationInput = z.infer<
  typeof annotationApiQueueConfigurationInputSchema
>;

export const annotationApiCreateQueueItemInputSchema = z.object({
  traceIds: z.array(z.string()),
  projectId: z.string(),
  annotators: z.array(z.string()),
});
export type AnnotationApiCreateQueueItemInput = z.infer<
  typeof annotationApiCreateQueueItemInputSchema
>;

export const annotationApiDeleteQueueItemsInputSchema = z.object({
  projectId: z.string(),
  queueItemIds: z.array(z.string()).min(1),
});
export type AnnotationApiDeleteQueueItemsInput = z.infer<
  typeof annotationApiDeleteQueueItemsInputSchema
>;

export const annotationApiMarkQueueItemDoneInputSchema = z.object({
  queueItemId: z.string(),
  projectId: z.string(),
});
export type AnnotationApiMarkQueueItemDoneInput = z.infer<
  typeof annotationApiMarkQueueItemDoneInputSchema
>;

export const annotationApiQueueBySlugOrIdInputSchema = z.object({
  projectId: z.string(),
  slug: z.string().optional(),
  queueId: z.string().optional(),
});
export type AnnotationApiQueueBySlugOrIdInput = z.infer<
  typeof annotationApiQueueBySlugOrIdInputSchema
>;

export const annotationApiOptimizedQueuesInputSchema = z.object({
  projectId: z.string(),
  selectedAnnotations: z.string(),
  pageSize: z.number(),
  pageOffset: z.number(),
  queueId: z.string().optional(),
  /**
   * Narrows the read to these queues. Only ever narrows: it is applied on top
   * of the reach the caller already has, so a queue id from anywhere else can
   * subtract rows but never add one.
   */
  queueIds: z.array(z.string()).optional(),
  showQueueAndUser: z.boolean().optional(),
  allQueueItems: z.boolean().optional(),
  // The list's date range. A queue item is dated by when it was queued, which
  // is what the reviewer sees in the list and filters on.
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});
export type AnnotationApiOptimizedQueuesInput = z.infer<
  typeof annotationApiOptimizedQueuesInputSchema
>;
