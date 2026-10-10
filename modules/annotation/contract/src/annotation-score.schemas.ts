import type { Named } from "@langwatch/module";
import { z } from "zod";

const annotationScoreOptionSchemaDefinition = z.object({
  value: z
    .union([z.string(), z.array(z.string())])
    .nullable()
    .optional(),
  reason: z.string().nullable().optional(),
});
export interface AnnotationScoreOptionSchema extends Named<
  typeof annotationScoreOptionSchemaDefinition
> {}
export const annotationScoreOptionSchema: AnnotationScoreOptionSchema =
  annotationScoreOptionSchemaDefinition;
const annotationScoreOptionsSchemaDefinition = z.record(z.string(), z.json());
export interface AnnotationScoreOptionsSchema extends Named<
  typeof annotationScoreOptionsSchemaDefinition
> {}
export const annotationScoreOptionsSchema: AnnotationScoreOptionsSchema =
  annotationScoreOptionsSchemaDefinition;

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

const annotationScoreSchemaDefinition = z
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
export interface AnnotationScoreSchema extends Named<typeof annotationScoreSchemaDefinition> {}
export const annotationScoreSchema: AnnotationScoreSchema = annotationScoreSchemaDefinition;
export type AnnotationScore = z.infer<typeof annotationScoreSchema>;

const annotationScoreNameSchemaDefinition = z
  .object({ id: z.string().min(1), name: z.string() })
  .strict();
export interface AnnotationScoreNameSchema extends Named<
  typeof annotationScoreNameSchemaDefinition
> {}
export const annotationScoreNameSchema: AnnotationScoreNameSchema =
  annotationScoreNameSchemaDefinition;
export type AnnotationScoreName = z.infer<typeof annotationScoreNameSchema>;

const upsertAnnotationScoreInputSchemaDefinition = z
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
export interface UpsertAnnotationScoreInputSchema extends Named<
  typeof upsertAnnotationScoreInputSchemaDefinition
> {}
export const upsertAnnotationScoreInputSchema: UpsertAnnotationScoreInputSchema =
  upsertAnnotationScoreInputSchemaDefinition;
export type UpsertAnnotationScoreInput = z.infer<typeof upsertAnnotationScoreInputSchema>;

export type AnnotationMode = "annotate" | "suggest";
export interface AnnotationScoreValue {
  value: string | string[];
  reason?: string;
}

export type ScoreOptions = Record<string, AnnotationScoreValue>;
