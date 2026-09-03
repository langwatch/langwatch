import { z } from "zod";

export const annotationScoreOptionSchema = z.object({
  value: z
    .union([z.string(), z.array(z.string())])
    .nullable()
    .optional(),
  reason: z.string().nullable().optional(),
});
export const annotationScoreOptionsSchema = z.record(z.string(), z.json());

export const annotationScoreDataTypeSchema = z.enum([
  "OPTION",
  "CHECKBOX",
  "BOOLEAN",
  "LIKERT",
  "CATEGORICAL",
]);
export type AnnotationScoreDataType = z.infer<typeof annotationScoreDataTypeSchema>;

const annotationScoreOptionsValueSchema = z.array(
  z.object({ label: z.string(), value: z.string(), reason: z.string().optional() }),
);
const annotationScoreDefaultValueSchema = z.object({
  value: z.string().nullable(),
  options: z.array(z.string()).nullable(),
});

export const annotationScoreSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    name: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
    deletedAt: z.date().nullable(),
    description: z.string().nullable(),
    active: z.boolean(),
    dataType: annotationScoreDataTypeSchema.nullable(),
    options: z.json().nullable(),
    defaultValue: z.json().nullable(),
    global: z.boolean(),
  })
  .strict();
export type AnnotationScore = z.infer<typeof annotationScoreSchema>;

export const annotationScoreNameSchema = z
  .object({ id: z.string().min(1), name: z.string() })
  .strict();
export type AnnotationScoreName = z.infer<typeof annotationScoreNameSchema>;

export const upsertAnnotationScoreInputSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    name: z.string(),
    dataType: annotationScoreDataTypeSchema,
    description: z.string(),
    options: annotationScoreOptionsValueSchema,
    defaultValue: annotationScoreDefaultValueSchema,
  })
  .strict();
export type UpsertAnnotationScoreInput = z.infer<typeof upsertAnnotationScoreInputSchema>;

/**
 * Rating a turn versus correcting its output.
 *
 * In the contract rather than in `annotation-web` because two features read it:
 * Annotation's own form and Trace's draft store, which was importing it from
 * `@langwatch/annotation-web` — a web package depending on another feature's
 * web package, which `cross-feature` refuses. It describes what a reviewer is
 * doing, not how anything renders.
 */
export type AnnotationMode = "annotate" | "suggest";

/** One score a reviewer entered, before it becomes a stored annotation. */
export interface AnnotationScoreValue {
  value: string | string[];
  reason?: string;
}

/** A draft's scores, keyed by score name. */
export type ScoreOptions = Record<string, AnnotationScoreValue>;
