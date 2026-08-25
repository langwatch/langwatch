import { z } from "zod";

export const annotationAnchorKinds = ["span", "field", "message"] as const;
export const annotationAnchorKindSchema = z.enum(annotationAnchorKinds);
export type AnnotationAnchorKind = z.infer<typeof annotationAnchorKindSchema>;

export const annotationAnchorColumnsSchema = z
  .object({
    anchorKind: annotationAnchorKindSchema.optional().nullable(),
    anchorId: z.string().min(1).optional().nullable(),
    anchorPath: z.string().min(1).optional().nullable(),
  })
  .superRefine((value, context) => {
    if (value.anchorKind && !value.anchorId) {
      context.addIssue({
        code: "custom",
        path: ["anchorId"],
        message: "An anchored annotation must name its target.",
      });
    }
    if (!value.anchorKind && (value.anchorId || value.anchorPath)) {
      context.addIssue({
        code: "custom",
        path: ["anchorKind"],
        message: "An annotation target must specify its kind.",
      });
    }
  });
export type AnnotationAnchorColumns = z.infer<
  typeof annotationAnchorColumnsSchema
>;

export const annotationAnchorScopes = ["trace", "all"] as const;
export const annotationAnchorScopeSchema = z.enum(annotationAnchorScopes);
export type AnnotationAnchorScope = z.infer<typeof annotationAnchorScopeSchema>;

export const annotationScoreOptionSchema = z.object({
  value: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  reason: z.string().nullable().optional(),
});
export const annotationScoreOptionsSchema = z.record(z.string(), z.unknown());

const annotationIdentitySchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  traceId: z.string().min(1),
});

export const annotationSchema = annotationIdentitySchema
  .extend({
    userId: z.string().min(1).nullable(),
    comment: z.string().nullable(),
    isThumbsUp: z.boolean().nullable(),
    scoreOptions: annotationScoreOptionsSchema,
    expectedOutput: z.string().nullable(),
    anchorKind: annotationAnchorKindSchema.nullable(),
    anchorId: z.string().nullable(),
    anchorPath: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type Annotation = z.infer<typeof annotationSchema>;

export const createAnnotationInputSchema = annotationIdentitySchema
  .extend({
    userId: z.string().min(1),
    comment: z.string(),
    isThumbsUp: z.boolean().nullable(),
    scoreOptions: annotationScoreOptionsSchema.default({}),
    expectedOutput: z.string().nullable(),
  })
  .merge(annotationAnchorColumnsSchema)
  .strict();
export type CreateAnnotationInput = z.infer<typeof createAnnotationInputSchema>;

export const updateAnnotationInputSchema = annotationIdentitySchema
  .extend({
    comment: z.string(),
    isThumbsUp: z.boolean().nullable(),
    scoreOptions: annotationScoreOptionsSchema.default({}),
    expectedOutput: z.string().nullable().optional(),
  })
  .strict();
export type UpdateAnnotationInput = z.infer<typeof updateAnnotationInputSchema>;

export const deleteAnnotationInputSchema = z
  .object({ id: z.string().min(1), projectId: z.string().min(1) })
  .strict();
export type DeleteAnnotationInput = z.infer<typeof deleteAnnotationInputSchema>;

export const listAnnotationsInputSchema = z
  .object({
    projectId: z.string().min(1),
    traceIds: z.array(z.string().min(1)).optional(),
    anchor: annotationAnchorScopeSchema.default("all"),
  })
  .strict();
export type ListAnnotationsInput = z.infer<typeof listAnnotationsInputSchema>;

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

export function annotationAnchorScopeWhere(
  scope: AnnotationAnchorScope,
): { anchorKind: null } | Record<string, never> {
  return scope === "trace" ? { anchorKind: null } : {};
}

export function withReadableAnnotationAnchor<T extends ProjectionAnnotation>(
  row: T,
): T {
  const kind = annotationAnchorKindSchema.safeParse(row.anchorKind);
  if (!kind.success || !row.anchorId) {
    return { ...row, anchorKind: null, anchorId: null, anchorPath: null };
  }
  return { ...row, anchorKind: kind.data };
}
