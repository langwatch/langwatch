/**
 * Every `annotationScore.*` procedure, declared once. Score definitions are
 * what a reviewer picks from, so the editor and the settings table read these
 * same schemas as their client's types.
 */

import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import {
  annotationScoreDataTypeSchema,
  annotationScoreSchema,
} from "./annotation-score.schemas.ts";
import { annotationApiProjectScopeSchema } from "./annotation-trpc.schemas.ts";

const annotationScoreUpsertInputSchemaDefinition = z.object({
  annotationScoreId: z.string().optional().nullable(),
  projectId: z.string(),
  name: z.string(),
  dataType: annotationScoreDataTypeSchema,
  description: z.string().optional().nullable(),
  options: z.object({}).optional().nullable(),
  category: z.array(z.string()).optional().nullable(),
  categoryExplanation: z.array(z.string()).optional().nullable(),
  radioCheckboxOptions: z.array(z.string()),
  defaultRadioOption: z.string().optional().nullable(),
  defaultCheckboxOption: z.array(z.string()).optional().nullable(),
});
export interface AnnotationScoreUpsertInputSchema extends Named<
  typeof annotationScoreUpsertInputSchemaDefinition
> {}
export const annotationScoreUpsertInputSchema: AnnotationScoreUpsertInputSchema =
  annotationScoreUpsertInputSchemaDefinition;
export type AnnotationScoreUpsertInput = z.input<typeof annotationScoreUpsertInputSchema>;

const annotationScoreScopeSchemaDefinition = z.object({
  projectId: z.string(),
  scoreId: z.string(),
});
export interface AnnotationScoreScopeSchema extends Named<
  typeof annotationScoreScopeSchemaDefinition
> {}
export const annotationScoreScopeSchema: AnnotationScoreScopeSchema =
  annotationScoreScopeSchemaDefinition;

/** Deactivating is not deleting: scores already recorded against it stay readable. */
const annotationScoreToggleInputSchemaDefinition = z.object({
  scoreId: z.string(),
  active: z.boolean(),
  projectId: z.string(),
});
export interface AnnotationScoreToggleInputSchema extends Named<
  typeof annotationScoreToggleInputSchemaDefinition
> {}
export const annotationScoreToggleInputSchema: AnnotationScoreToggleInputSchema =
  annotationScoreToggleInputSchemaDefinition;

export const annotationScoreTrpc = defineTrpcContract("annotationScore")
  .mutation("upsert")
  .withInput(annotationScoreUpsertInputSchema)
  .withOutput(annotationScoreSchema)

  .query("getAll")
  .withInput(annotationApiProjectScopeSchema)
  .withOutput(annotationScoreSchema.array())

  /** Only the definitions a reviewer can still pick, for the queue editor. */
  .query("getAllActive")
  .withInput(annotationApiProjectScopeSchema)
  .withOutput(annotationScoreSchema.array())

  .query("getById")
  .withInput(annotationScoreScopeSchema)
  .withOutput(annotationScoreSchema)

  .mutation("toggle")
  .withInput(annotationScoreToggleInputSchema)
  .withOutput(annotationScoreSchema)

  .mutation("delete")
  .withInput(annotationScoreScopeSchema)
  .withOutput(annotationScoreSchema)
  .build();
