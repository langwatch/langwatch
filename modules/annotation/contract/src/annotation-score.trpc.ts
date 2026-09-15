/**
 * Every `annotationScore.*` procedure, declared once. Score definitions are
 * what a reviewer picks from, so the editor and the settings table read these
 * same schemas as their client's types.
 */

import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  annotationScoreDataTypeSchema,
  annotationScoreSchema,
} from "./annotation-score.schemas.ts";
import { annotationApiProjectScopeSchema } from "./annotation-trpc.schemas.ts";

export const annotationScoreUpsertInputSchema = z.object({
  annotationScoreId: z.string().optional().nullable(),
  projectId: z.string(),
  name: z.string(),
  dataType: annotationScoreDataTypeSchema,
  description: z.string().optional().nullable(),
  options: z.array(z.string()).optional().nullable(),
  category: z.array(z.string()).optional().nullable(),
  categoryExplanation: z.array(z.string()).optional().nullable(),
  radioCheckboxOptions: z.array(z.string()),
  defaultRadioOption: z.string().optional().nullable(),
  defaultCheckboxOption: z.array(z.string()).optional().nullable(),
});
export type AnnotationScoreUpsertInput = z.input<typeof annotationScoreUpsertInputSchema>;

export const annotationScoreScopeSchema = z.object({
  projectId: z.string(),
  scoreId: z.string(),
});

/** Deactivating is not deleting: scores already recorded against it stay readable. */
export const annotationScoreToggleInputSchema = z.object({
  scoreId: z.string(),
  active: z.boolean(),
  projectId: z.string(),
});

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
