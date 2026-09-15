import { z } from "zod";
import { annotationAnchorScopeSchema } from "./annotation-anchor.schemas.ts";
import { annotationSchema } from "./annotation.schemas.ts";

export const annotationRestParamsSchema = z.object({ id: z.string().min(1) });

export const annotationRestQuerySchema = z.object({
  anchor: annotationAnchorScopeSchema.default("all"),
});

export const annotationRestWriteSchema = z.object({
  comment: z.string().min(1),
  isThumbsUp: z.boolean(),
  email: z.string().nullable().optional(),
});

export const createUnattributedAnnotationSchema = z.object({
  ...annotationRestWriteSchema.shape,
  projectId: z.string().min(1),
  traceId: z.string().min(1),
});
export type CreateUnattributedAnnotationInput = z.output<typeof createUnattributedAnnotationSchema>;

// Existing REST callers receive the complete stored row, including extra projection fields.
const annotationRestRecordSchema = z.looseObject(annotationSchema.shape);

export const annotationRestResponseSchema = z.object({ data: annotationRestRecordSchema });
export const annotationRestListResponseSchema = z.object({
  data: z.array(annotationRestRecordSchema),
});
