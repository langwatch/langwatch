import type { Named } from "@langwatch/module";
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

const annotationUserSchemaDefinition = z
  .object({
    id: annotationIdSchema,
    name: z.string().nullable(),
    image: z.string().nullable(),
  })
  .strict();
export interface AnnotationUserSchema extends Named<typeof annotationUserSchemaDefinition> {}
export const annotationUserSchema: AnnotationUserSchema = annotationUserSchemaDefinition;
export type AnnotationUser = z.infer<typeof annotationUserSchema>;

const annotationIdentitySchema = z.object({
  id: annotationIdSchema,
  projectId: annotationProjectIdSchema,
  traceId: z.string().min(1),
});

const annotationSchemaDefinition = z
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
export interface AnnotationSchema extends Named<typeof annotationSchemaDefinition> {}
export const annotationSchema: AnnotationSchema = annotationSchemaDefinition;
export type Annotation = z.infer<typeof annotationSchema>;

const createAnnotationInputSchemaDefinition = z
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
export interface CreateAnnotationInputSchema extends Named<
  typeof createAnnotationInputSchemaDefinition
> {}
export const createAnnotationInputSchema: CreateAnnotationInputSchema =
  createAnnotationInputSchemaDefinition;
export type CreateAnnotationInput = z.infer<typeof createAnnotationInputSchema>;

const updateAnnotationInputSchemaDefinition = z
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
export interface UpdateAnnotationInputSchema extends Named<
  typeof updateAnnotationInputSchemaDefinition
> {}
export const updateAnnotationInputSchema: UpdateAnnotationInputSchema =
  updateAnnotationInputSchemaDefinition;
export type UpdateAnnotationInput = z.infer<typeof updateAnnotationInputSchema>;

const annotationByIdInputSchemaDefinition = z
  .object({ id: annotationIdSchema, projectId: annotationProjectIdSchema })
  .strict();
export interface AnnotationByIdInputSchema extends Named<
  typeof annotationByIdInputSchemaDefinition
> {}
export const annotationByIdInputSchema: AnnotationByIdInputSchema =
  annotationByIdInputSchemaDefinition;
export type AnnotationByIdInput = z.infer<typeof annotationByIdInputSchema>;

export const deleteAnnotationInputSchema = annotationByIdInputSchema;
export type DeleteAnnotationInput = z.infer<typeof deleteAnnotationInputSchema>;

const listAnnotationsInputSchemaDefinition = z
  .object({
    projectId: annotationProjectIdSchema,
    traceIds: z.array(z.string().min(1)).optional(),
    anchor: annotationAnchorScopeSchema.default("all"),
    order: z.enum(["asc", "desc"]).optional(),
    startDate: z.date().optional(),
    endDate: z.date().optional(),
  })
  .strict();
export interface ListAnnotationsInputSchema extends Named<
  typeof listAnnotationsInputSchemaDefinition
> {}
export const listAnnotationsInputSchema: ListAnnotationsInputSchema =
  listAnnotationsInputSchemaDefinition;
export type ListAnnotationsInput = z.infer<typeof listAnnotationsInputSchema>;

const listProjectionAnnotationsInputSchemaDefinition = z
  .object({
    projectId: annotationProjectIdSchema,
    traceIds: z.array(z.string().min(1)),
    anchor: annotationAnchorScopeSchema.default("all"),
  })
  .strict();
export interface ListProjectionAnnotationsInputSchema extends Named<
  typeof listProjectionAnnotationsInputSchemaDefinition
> {}
export const listProjectionAnnotationsInputSchema: ListProjectionAnnotationsInputSchema =
  listProjectionAnnotationsInputSchemaDefinition;
export type ListProjectionAnnotationsInput = z.input<typeof listProjectionAnnotationsInputSchema>;

const projectionAnnotationSchemaDefinition = annotationSchema
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
export interface ProjectionAnnotationSchema extends Named<
  typeof projectionAnnotationSchemaDefinition
> {}
export const projectionAnnotationSchema: ProjectionAnnotationSchema =
  projectionAnnotationSchemaDefinition;
export type ProjectionAnnotation = z.infer<typeof projectionAnnotationSchema>;

const listAnnotationScoreNamesInputSchemaDefinition = z
  .object({ projectId: annotationProjectIdSchema })
  .strict();
export interface ListAnnotationScoreNamesInputSchema extends Named<
  typeof listAnnotationScoreNamesInputSchemaDefinition
> {}
export const listAnnotationScoreNamesInputSchema: ListAnnotationScoreNamesInputSchema =
  listAnnotationScoreNamesInputSchemaDefinition;
export type ListAnnotationScoreNamesInput = z.infer<typeof listAnnotationScoreNamesInputSchema>;

const listAnnotationScoresInputSchemaDefinition = z
  .object({
    projectId: annotationProjectIdSchema,
    activeOnly: z.boolean().optional(),
  })
  .strict();
export interface ListAnnotationScoresInputSchema extends Named<
  typeof listAnnotationScoresInputSchemaDefinition
> {}
export const listAnnotationScoresInputSchema: ListAnnotationScoresInputSchema =
  listAnnotationScoresInputSchemaDefinition;
export type ListAnnotationScoresInput = z.infer<typeof listAnnotationScoresInputSchema>;

const annotationScoreByIdInputSchemaDefinition = z
  .object({ id: annotationIdSchema, projectId: annotationProjectIdSchema })
  .strict();
export interface AnnotationScoreByIdInputSchema extends Named<
  typeof annotationScoreByIdInputSchemaDefinition
> {}
export const annotationScoreByIdInputSchema: AnnotationScoreByIdInputSchema =
  annotationScoreByIdInputSchemaDefinition;
export type AnnotationScoreByIdInput = z.infer<typeof annotationScoreByIdInputSchema>;

const toggleAnnotationScoreInputSchemaDefinition = z
  .object({ ...annotationScoreByIdInputSchema.shape, active: z.boolean() })
  .strict();
export interface ToggleAnnotationScoreInputSchema extends Named<
  typeof toggleAnnotationScoreInputSchemaDefinition
> {}
export const toggleAnnotationScoreInputSchema: ToggleAnnotationScoreInputSchema =
  toggleAnnotationScoreInputSchemaDefinition;
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
