import type { Named } from "@langwatch/module";
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

const annotationApiScoreOptionsSchemaDefinition = z.record(z.string(), annotationScoreOptionSchema);
export interface AnnotationApiScoreOptionsSchema extends Named<
  typeof annotationApiScoreOptionsSchemaDefinition
> {}
export const annotationApiScoreOptionsSchema: AnnotationApiScoreOptionsSchema =
  annotationApiScoreOptionsSchemaDefinition;
export type AnnotationApiScoreOptions = z.infer<typeof annotationApiScoreOptionsSchema>;

const annotationApiCreateInputSchemaDefinition = z
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
export interface AnnotationApiCreateInputSchema extends Named<
  typeof annotationApiCreateInputSchemaDefinition
> {}
export const annotationApiCreateInputSchema: AnnotationApiCreateInputSchema =
  annotationApiCreateInputSchemaDefinition;
export type AnnotationApiCreateInput = z.infer<typeof annotationApiCreateInputSchema>;

const annotationApiUpdateInputSchemaDefinition = z.object({
  id: z.string(),
  traceId: z.string(),
  projectId: z.string(),
  comment: z.string().optional().nullable(),
  isThumbsUp: z.boolean().optional().nullable(),
  expectedOutput: z.string().optional().nullable(),
  scoreOptions: annotationApiScoreOptionsSchema,
});
export interface AnnotationApiUpdateInputSchema extends Named<
  typeof annotationApiUpdateInputSchemaDefinition
> {}
export const annotationApiUpdateInputSchema: AnnotationApiUpdateInputSchema =
  annotationApiUpdateInputSchemaDefinition;
export type AnnotationApiUpdateInput = z.infer<typeof annotationApiUpdateInputSchema>;

const annotationApiByTraceIdInputSchemaDefinition = z.object({
  traceId: z.string(),
  projectId: z.string(),
  anchor: annotationAnchorScopeSchema.optional().default("all"),
});
export interface AnnotationApiByTraceIdInputSchema extends Named<
  typeof annotationApiByTraceIdInputSchemaDefinition
> {}
export const annotationApiByTraceIdInputSchema: AnnotationApiByTraceIdInputSchema =
  annotationApiByTraceIdInputSchemaDefinition;
export type AnnotationApiByTraceIdInput = z.infer<typeof annotationApiByTraceIdInputSchema>;

const annotationApiByTraceIdsInputSchemaDefinition = z.object({
  traceIds: z.array(z.string()),
  projectId: z.string(),
  anchor: annotationAnchorScopeSchema.optional().default("all"),
});
export interface AnnotationApiByTraceIdsInputSchema extends Named<
  typeof annotationApiByTraceIdsInputSchemaDefinition
> {}
export const annotationApiByTraceIdsInputSchema: AnnotationApiByTraceIdsInputSchema =
  annotationApiByTraceIdsInputSchemaDefinition;
export type AnnotationApiByTraceIdsInput = z.infer<typeof annotationApiByTraceIdsInputSchema>;

const annotationApiAnnotationScopeSchemaDefinition = z.object({
  annotationId: z.string(),
  projectId: z.string(),
});
export interface AnnotationApiAnnotationScopeSchema extends Named<
  typeof annotationApiAnnotationScopeSchemaDefinition
> {}
export const annotationApiAnnotationScopeSchema: AnnotationApiAnnotationScopeSchema =
  annotationApiAnnotationScopeSchemaDefinition;
export type AnnotationApiAnnotationScope = z.infer<typeof annotationApiAnnotationScopeSchema>;

const annotationApiProjectScopeSchemaDefinition = z.object({ projectId: z.string() });
export interface AnnotationApiProjectScopeSchema extends Named<
  typeof annotationApiProjectScopeSchemaDefinition
> {}
export const annotationApiProjectScopeSchema: AnnotationApiProjectScopeSchema =
  annotationApiProjectScopeSchemaDefinition;

const annotationApiQueueListInputSchemaDefinition = z.object({
  projectId: z.string(),
  reachableOnly: z.boolean().optional(),
});
export interface AnnotationApiQueueListInputSchema extends Named<
  typeof annotationApiQueueListInputSchemaDefinition
> {}
export const annotationApiQueueListInputSchema: AnnotationApiQueueListInputSchema =
  annotationApiQueueListInputSchemaDefinition;
export type AnnotationApiQueueListInput = z.infer<typeof annotationApiQueueListInputSchema>;
export type AnnotationApiProjectScope = z.infer<typeof annotationApiProjectScopeSchema>;

const annotationApiListAllInputSchemaDefinition = z.object({
  projectId: z.string(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});
export interface AnnotationApiListAllInputSchema extends Named<
  typeof annotationApiListAllInputSchemaDefinition
> {}
export const annotationApiListAllInputSchema: AnnotationApiListAllInputSchema =
  annotationApiListAllInputSchemaDefinition;
export type AnnotationApiListAllInput = z.infer<typeof annotationApiListAllInputSchema>;

const annotationApiQueueConfigurationInputSchemaDefinition = z.object({
  projectId: z.string(),
  name: z.string(),
  description: z.string(),
  userIds: z.array(z.string()),
  scoreTypeIds: z.array(z.string()),
  queueId: z.string().optional(),
});
export interface AnnotationApiQueueConfigurationInputSchema extends Named<
  typeof annotationApiQueueConfigurationInputSchemaDefinition
> {}
export const annotationApiQueueConfigurationInputSchema: AnnotationApiQueueConfigurationInputSchema =
  annotationApiQueueConfigurationInputSchemaDefinition;
export type AnnotationApiQueueConfigurationInput = z.infer<
  typeof annotationApiQueueConfigurationInputSchema
>;

const annotationApiCreateQueueItemInputSchemaDefinition = z.object({
  traceIds: z.array(z.string()),
  projectId: z.string(),
  annotators: z.array(z.string()),
});
export interface AnnotationApiCreateQueueItemInputSchema extends Named<
  typeof annotationApiCreateQueueItemInputSchemaDefinition
> {}
export const annotationApiCreateQueueItemInputSchema: AnnotationApiCreateQueueItemInputSchema =
  annotationApiCreateQueueItemInputSchemaDefinition;
export type AnnotationApiCreateQueueItemInput = z.infer<
  typeof annotationApiCreateQueueItemInputSchema
>;

const annotationApiDeleteQueueItemsInputSchemaDefinition = z.object({
  projectId: z.string(),
  queueItemIds: z.array(z.string()).min(1),
});
export interface AnnotationApiDeleteQueueItemsInputSchema extends Named<
  typeof annotationApiDeleteQueueItemsInputSchemaDefinition
> {}
export const annotationApiDeleteQueueItemsInputSchema: AnnotationApiDeleteQueueItemsInputSchema =
  annotationApiDeleteQueueItemsInputSchemaDefinition;
export type AnnotationApiDeleteQueueItemsInput = z.infer<
  typeof annotationApiDeleteQueueItemsInputSchema
>;

const annotationApiMarkQueueItemDoneInputSchemaDefinition = z.object({
  queueItemId: z.string(),
  projectId: z.string(),
});
export interface AnnotationApiMarkQueueItemDoneInputSchema extends Named<
  typeof annotationApiMarkQueueItemDoneInputSchemaDefinition
> {}
export const annotationApiMarkQueueItemDoneInputSchema: AnnotationApiMarkQueueItemDoneInputSchema =
  annotationApiMarkQueueItemDoneInputSchemaDefinition;
export type AnnotationApiMarkQueueItemDoneInput = z.infer<
  typeof annotationApiMarkQueueItemDoneInputSchema
>;

const annotationApiQueueBySlugOrIdInputSchemaDefinition = z.object({
  projectId: z.string(),
  slug: z.string().optional(),
  queueId: z.string().optional(),
});
export interface AnnotationApiQueueBySlugOrIdInputSchema extends Named<
  typeof annotationApiQueueBySlugOrIdInputSchemaDefinition
> {}
export const annotationApiQueueBySlugOrIdInputSchema: AnnotationApiQueueBySlugOrIdInputSchema =
  annotationApiQueueBySlugOrIdInputSchemaDefinition;
export type AnnotationApiQueueBySlugOrIdInput = z.infer<
  typeof annotationApiQueueBySlugOrIdInputSchema
>;

const annotationApiOptimizedQueuesInputSchemaDefinition = z.object({
  projectId: z.string(),
  selectedAnnotations: annotationQueueItemStatusSchema,
  pageSize: z.number().int().min(1).max(ANNOTATION_PAGE_SIZE_MAX).default(25),
  pageOffset: z.number().int().min(0).default(0),
  queueId: z.string().optional(),
  queueIds: z.array(z.string()).optional(),
  showQueueAndUser: z.boolean().optional(),
  allQueueItems: z.boolean().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});
export interface AnnotationApiOptimizedQueuesInputSchema extends Named<
  typeof annotationApiOptimizedQueuesInputSchemaDefinition
> {}
export const annotationApiOptimizedQueuesInputSchema: AnnotationApiOptimizedQueuesInputSchema =
  annotationApiOptimizedQueuesInputSchemaDefinition;
export type AnnotationApiOptimizedQueuesInput = z.infer<
  typeof annotationApiOptimizedQueuesInputSchema
>;

/** Absent `queueItemId` starts the walk at the front of the caller's pending queue. */
const annotationApiQueueWalkStepInputSchemaDefinition = z.object({
  projectId: z.string(),
  queueItemId: z.string().optional(),
});
export interface AnnotationApiQueueWalkStepInputSchema extends Named<
  typeof annotationApiQueueWalkStepInputSchemaDefinition
> {}
export const annotationApiQueueWalkStepInputSchema: AnnotationApiQueueWalkStepInputSchema =
  annotationApiQueueWalkStepInputSchemaDefinition;
export type AnnotationApiQueueWalkStepInput = z.infer<typeof annotationApiQueueWalkStepInputSchema>;
