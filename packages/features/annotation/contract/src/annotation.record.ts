import { z } from "zod";
import {
  annotationAnchorColumnsSchema,
  annotationAnchorScopeSchema,
} from "./annotation.anchor";
import { annotationScoreOptionsSchema } from "./annotation.score";

const annotationIdSchema = z.string().min(1);
const annotationProjectIdSchema = z.string().min(1);

export const annotationUserSchema = z
  .object({
    id: annotationIdSchema,
    name: z.string().nullable(),
    image: z.string().nullable(),
  })
  .strict();
export type AnnotationUser = z.infer<typeof annotationUserSchema>;

const annotationIdentitySchema = z.object({
  id: annotationIdSchema,
  projectId: annotationProjectIdSchema,
  traceId: z.string().min(1),
});

export const annotationSchema = annotationIdentitySchema
  .extend({
    userId: z.string().min(1).nullable(),
    email: z.string().nullable(),
    comment: z.string().nullable(),
    isThumbsUp: z.boolean().nullable(),
    scoreOptions: annotationScoreOptionsSchema,
    expectedOutput: z.string().nullable(),
    anchorKind: z.string().nullable(),
    anchorId: z.string().nullable(),
    anchorPath: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type Annotation = z.infer<typeof annotationSchema>;

export const createAnnotationInputSchema = annotationIdentitySchema
  .extend({
    userId: z.string().min(1).nullable().optional(),
    email: z.string().nullable().optional(),
    comment: z.string(),
    isThumbsUp: z.boolean().nullable(),
    scoreOptions: annotationScoreOptionsSchema.default({}),
    expectedOutput: z.string().nullable(),
  })
  .merge(annotationAnchorColumnsSchema)
  .strict();
export type CreateAnnotationInput = z.infer<typeof createAnnotationInputSchema>;

export const updateAnnotationInputSchema = z
  .object({
    id: annotationIdSchema,
    projectId: annotationProjectIdSchema,
    traceId: z.string().min(1).optional(),
  })
  .extend({
    comment: z.string(),
    isThumbsUp: z.boolean().nullable().optional(),
    email: z.string().nullable().optional(),
    scoreOptions: annotationScoreOptionsSchema.optional(),
    expectedOutput: z.string().nullable().optional(),
  })
  .strict();
export type UpdateAnnotationInput = z.infer<typeof updateAnnotationInputSchema>;

export const annotationByIdInputSchema = z
  .object({ id: annotationIdSchema, projectId: annotationProjectIdSchema })
  .strict();
export type AnnotationByIdInput = z.infer<typeof annotationByIdInputSchema>;

export const deleteAnnotationInputSchema = annotationByIdInputSchema;
export type DeleteAnnotationInput = z.infer<typeof deleteAnnotationInputSchema>;

export const listAnnotationsInputSchema = z
  .object({
    projectId: annotationProjectIdSchema,
    traceIds: z.array(z.string().min(1)).optional(),
    anchor: annotationAnchorScopeSchema.default("all"),
    order: z.enum(["asc", "desc"]).optional(),
    startDate: z.date().optional(),
    endDate: z.date().optional(),
  })
  .strict();
export type ListAnnotationsInput = z.infer<typeof listAnnotationsInputSchema>;

export const listProjectionAnnotationsInputSchema = z
  .object({
    projectId: annotationProjectIdSchema,
    traceIds: z.array(z.string().min(1)),
    anchor: annotationAnchorScopeSchema.default("all"),
  })
  .strict();
export type ListProjectionAnnotationsInput = z.input<
  typeof listProjectionAnnotationsInputSchema
>;

export const projectionAnnotationSchema = annotationSchema
  .pick({
    id: true,
    traceId: true,
    isThumbsUp: true,
    comment: true,
    expectedOutput: true,
    scoreOptions: true,
    createdAt: true,
    anchorKind: true,
    anchorId: true,
    anchorPath: true,
  })
  .strict();
export type ProjectionAnnotation = z.infer<typeof projectionAnnotationSchema>;

export const listAnnotationScoreNamesInputSchema = z
  .object({ projectId: annotationProjectIdSchema })
  .strict();
export type ListAnnotationScoreNamesInput = z.infer<
  typeof listAnnotationScoreNamesInputSchema
>;

export const listAnnotationScoresInputSchema = z
  .object({
    projectId: annotationProjectIdSchema,
    activeOnly: z.boolean().optional(),
  })
  .strict();
export type ListAnnotationScoresInput = z.infer<typeof listAnnotationScoresInputSchema>;

export const annotationScoreByIdInputSchema = z
  .object({ id: annotationIdSchema, projectId: annotationProjectIdSchema })
  .strict();
export type AnnotationScoreByIdInput = z.infer<typeof annotationScoreByIdInputSchema>;

export const toggleAnnotationScoreInputSchema = annotationScoreByIdInputSchema
  .extend({ active: z.boolean() })
  .strict();
export type ToggleAnnotationScoreInput = z.infer<typeof toggleAnnotationScoreInputSchema>;

export const createAnnotationQueueItemsInputSchema = z
  .object({
    projectId: annotationProjectIdSchema,
    traceIds: z.array(z.string().min(1)),
    queueIds: z.array(z.string().min(1)),
    userIds: z.array(z.string().min(1)),
    createdByUserId: z.string().min(1),
  })
  .strict();
export type CreateAnnotationQueueItemsInput = z.infer<
  typeof createAnnotationQueueItemsInputSchema
>;

export const annotationProjectInputSchema = z
  .object({ projectId: annotationProjectIdSchema })
  .strict();
export type AnnotationProjectInput = z.infer<typeof annotationProjectInputSchema>;

export const assertQueueConfigurationReferencesInputSchema = z
  .object({
    projectId: annotationProjectIdSchema,
    userIds: z.array(z.string().min(1)),
    scoreTypeIds: z.array(z.string().min(1)),
  })
  .strict();
export type AssertQueueConfigurationReferencesInput = z.infer<
  typeof assertQueueConfigurationReferencesInputSchema
>;

export const assertAnnotatorReferencesInputSchema = z
  .object({
    projectId: annotationProjectIdSchema,
    queueIds: z.array(z.string().min(1)),
    userIds: z.array(z.string().min(1)),
  })
  .strict();
export type AssertAnnotatorReferencesInput = z.infer<
  typeof assertAnnotatorReferencesInputSchema
>;

/**
 * A stored annotation with the author the read path resolved for it.
 *
 * The author is narrowed to the fields a rendered annotation names rather than
 * reusing {@link AnnotationUser}: requiring the whole user row forced every
 * caller to fetch every user column — email, lastLoginAt and the rest — just
 * to satisfy the type, which is how those columns ended up shipped to the
 * browser. Timestamps widen to strings because a serialised annotation crosses
 * the wire before it is rendered.
 */
export type AnnotationWithUser = {
  id: string;
  projectId: string;
  traceId: string;
  userId: string | null;
  email?: string | null;
  comment: string | null;
  isThumbsUp: boolean | null;
  scoreOptions: unknown;
  expectedOutput: string | null;
  anchorKind: string | null;
  anchorId: string | null;
  anchorPath: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
  user?: { id: string; name: string | null; image?: string | null } | null;
};
