import type { Named } from "@langwatch/module";
import { z } from "zod";

import { annotationAnchorScopeSchema } from "./annotation-anchor.schemas.ts";
import { annotationSchema } from "./annotation.schemas.ts";

const annotationRestParamsSchemaDefinition = z.object({ id: z.string().min(1) });
export interface AnnotationRestParamsSchema extends Named<
  typeof annotationRestParamsSchemaDefinition
> {}
export const annotationRestParamsSchema: AnnotationRestParamsSchema =
  annotationRestParamsSchemaDefinition;

const annotationRestQuerySchemaDefinition = z.object({
  anchor: annotationAnchorScopeSchema.default("all"),
});
export interface AnnotationRestQuerySchema extends Named<
  typeof annotationRestQuerySchemaDefinition
> {}
export const annotationRestQuerySchema: AnnotationRestQuerySchema =
  annotationRestQuerySchemaDefinition;

const annotationRestWriteSchemaDefinition = z.object({
  comment: z.string().min(1),
  isThumbsUp: z.boolean(),
  email: z.string().nullable().optional(),
});
export interface AnnotationRestWriteSchema extends Named<
  typeof annotationRestWriteSchemaDefinition
> {}
export const annotationRestWriteSchema: AnnotationRestWriteSchema =
  annotationRestWriteSchemaDefinition;

const createUnattributedAnnotationSchemaDefinition = z.object({
  ...annotationRestWriteSchema.shape,
  projectId: z.string().min(1),
  traceId: z.string().min(1),
});
export interface CreateUnattributedAnnotationSchema extends Named<
  typeof createUnattributedAnnotationSchemaDefinition
> {}
export const createUnattributedAnnotationSchema: CreateUnattributedAnnotationSchema =
  createUnattributedAnnotationSchemaDefinition;
export type CreateUnattributedAnnotationInput = z.output<typeof createUnattributedAnnotationSchema>;

// Existing REST callers receive the complete stored row, including extra projection fields.
// Published as the `Annotation` component the generated clients name their type after.
const annotationRestRecordSchema = z.looseObject(annotationSchema.shape).meta({ id: "Annotation" });

const annotationRestResponseSchemaDefinition = z.object({ data: annotationRestRecordSchema });
export interface AnnotationRestResponseSchema extends Named<
  typeof annotationRestResponseSchemaDefinition
> {}
export const annotationRestResponseSchema: AnnotationRestResponseSchema =
  annotationRestResponseSchemaDefinition;
const annotationRestListResponseSchemaDefinition = z.object({
  data: z.array(annotationRestRecordSchema),
});
export interface AnnotationRestListResponseSchema extends Named<
  typeof annotationRestListResponseSchemaDefinition
> {}
export const annotationRestListResponseSchema: AnnotationRestListResponseSchema =
  annotationRestListResponseSchemaDefinition;

/** The acknowledgement `DELETE /api/annotations/:id` has always answered with. */
const annotationRestDeletedSchemaDefinition = z.object({
  status: z.string(),
  message: z.string(),
});
export interface AnnotationRestDeletedSchema extends Named<
  typeof annotationRestDeletedSchemaDefinition
> {}
export const annotationRestDeletedSchema: AnnotationRestDeletedSchema =
  annotationRestDeletedSchemaDefinition;
