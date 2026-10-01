import { resolveRequestBound } from "@langwatch/plans";
import { z } from "zod";

import {
  annotationAnchorColumnsSchema,
  annotationAnchorScopeSchema,
  refineAnnotationAnchorColumns,
} from "./annotation-anchor.schemas.ts";
import { annotationQueueItemStatusSchema } from "./annotation-queue.schemas.ts";
import { annotationScoreOptionSchema } from "./annotation-score.schemas.ts";

/**
 * The outer validation shell is the registry's enterprise ceiling; the
 * application clamps the effective page size and the all-queue-items take to
 * the caller's tier through the entitlement peer.
 */
const ANNOTATION_PAGE_SIZE_MAX = resolveRequestBound("annotationPageSizeMax", "ENTERPRISE");

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
    ...annotationAnchorColumnsSchema.shape,
  })
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
  selectedAnnotations: annotationQueueItemStatusSchema,
  pageSize: z.number().int().min(1).max(ANNOTATION_PAGE_SIZE_MAX).default(25),
  pageOffset: z.number().int().min(0).default(0),
  queueId: z.string().optional(),
  queueIds: z.array(z.string()).optional(),
  showQueueAndUser: z.boolean().optional(),
  allQueueItems: z.boolean().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});
export type AnnotationApiOptimizedQueuesInput = z.infer<
  typeof annotationApiOptimizedQueuesInputSchema
>;

/** Absent `queueItemId` starts the walk at the front of the caller's pending queue. */
export const annotationApiQueueWalkStepInputSchema = z.object({
  projectId: z.string(),
  queueItemId: z.string().optional(),
});
export type AnnotationApiQueueWalkStepInput = z.infer<typeof annotationApiQueueWalkStepInputSchema>;
