import type { TimeInput } from "@langwatch/time";
import { z } from "zod";
import {
  annotationAnchorColumnsSchema,
  annotationAnchorScopeSchema,
  refineAnnotationAnchorColumns,
} from "./annotation-anchor.schemas.ts";
import { annotationScoreOptionsSchema } from "./annotation-score.schemas.ts";

export const ANNOTATION_KSUID_RESOURCE = "annotation";

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

export const annotationSchema = z
  .object({
    ...annotationIdentitySchema.shape,
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

export const createAnnotationInputSchema = z
  .object({
    ...annotationIdentitySchema.shape,
    userId: z.string().min(1).nullable().optional(),
    email: z.string().nullable().optional(),
    comment: z.string(),
    isThumbsUp: z.boolean().nullable(),
    scoreOptions: annotationScoreOptionsSchema.default({}),
    expectedOutput: z.string().nullable(),
    ...annotationAnchorColumnsSchema.shape,
  })
  .superRefine(refineAnnotationAnchorColumns)
  .strict();
export type CreateAnnotationInput = z.infer<typeof createAnnotationInputSchema>;

export const updateAnnotationInputSchema = z
  .object({
    id: annotationIdSchema,
    projectId: annotationProjectIdSchema,
    traceId: z.string().min(1).optional(),
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
export type ListProjectionAnnotationsInput = z.input<typeof listProjectionAnnotationsInputSchema>;

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
export type ListAnnotationScoreNamesInput = z.infer<typeof listAnnotationScoreNamesInputSchema>;

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

export const toggleAnnotationScoreInputSchema = z
  .object({ ...annotationScoreByIdInputSchema.shape, active: z.boolean() })
  .strict();
export type ToggleAnnotationScoreInput = z.infer<typeof toggleAnnotationScoreInputSchema>;

export type AnnotationWithUser = {
  id: string;
  projectId: string;
  traceId: string;
  userId: string | null;
  email?: string | null;
  comment: string | null;
  isThumbsUp: boolean | null;
  scoreOptions?: unknown;
  expectedOutput: string | null;
  anchorKind: string | null;
  anchorId: string | null;
  anchorPath: string | null;
  createdAt: TimeInput | null;
  updatedAt: TimeInput | null;
  user?: { id: string; name: string | null; image?: string | null } | null;
};
