import type { Named } from "@langwatch/module";
import { z } from "zod";

import { annotationScoreOptionsSchema } from "./annotation-score.schemas.ts";

/** Annotation's own facts; trace folds them into its read model from its side (§9, EF-1). */
export const ANNOTATION_CREATED_EVENT_TYPE = "lw.annotation.created" as const;
export const ANNOTATION_UPDATED_EVENT_TYPE = "lw.annotation.updated" as const;
export const ANNOTATION_DELETED_EVENT_TYPE = "lw.annotation.deleted" as const;
export const ANNOTATION_SCORE_DEFINED_EVENT_TYPE = "lw.annotation.score_defined" as const;
export const ANNOTATION_SCORE_RENAMED_EVENT_TYPE = "lw.annotation.score_renamed" as const;
export const ANNOTATION_FACTS_EVENT_VERSION = "2026-10-08" as const;

const epochMillisSchema = z.number().int().nonnegative();

/** What a reader of an annotation sees, after the write; no author, no email (§9). */
const annotationContentEventDataSchemaDefinition = z.object({
  annotationId: z.string().min(1),
  projectId: z.string().min(1),
  traceId: z.string().min(1),
  comment: z.string().nullable(),
  isThumbsUp: z.boolean().nullable(),
  expectedOutput: z.string().nullable(),
  /** Keyed by score definition id; `lw.annotation.score_defined` names them. */
  scoreOptions: annotationScoreOptionsSchema,
  anchorKind: z.string().nullable(),
  anchorId: z.string().nullable(),
  anchorPath: z.string().nullable(),
  createdAt: epochMillisSchema,
  /** The row's write instant: a fold keeps the newest content whatever order facts arrive in. */
  updatedAt: epochMillisSchema,
  occurredAt: epochMillisSchema,
});
export interface AnnotationContentEventDataSchema extends Named<
  typeof annotationContentEventDataSchemaDefinition
> {}
export const annotationContentEventDataSchema: AnnotationContentEventDataSchema =
  annotationContentEventDataSchemaDefinition;
export type AnnotationContentEventData = z.infer<typeof annotationContentEventDataSchema>;

/** A new annotation, or (backfilled) one that existed before annotation recorded facts. */
const annotationCreatedEventDataSchemaDefinition = z.object({
  ...annotationContentEventDataSchema.shape,
  backfilled: z.boolean().optional(),
});
export interface AnnotationCreatedEventDataSchema extends Named<
  typeof annotationCreatedEventDataSchemaDefinition
> {}
export const annotationCreatedEventDataSchema: AnnotationCreatedEventDataSchema =
  annotationCreatedEventDataSchemaDefinition;
export type AnnotationCreatedEventData = z.infer<typeof annotationCreatedEventDataSchema>;

export const annotationUpdatedEventDataSchema = annotationContentEventDataSchema;
export type AnnotationUpdatedEventData = z.infer<typeof annotationUpdatedEventDataSchema>;

/** The row is gone; a reader drops it whatever arrives for it later. */
const annotationDeletedEventDataSchemaDefinition = z.object({
  annotationId: z.string().min(1),
  projectId: z.string().min(1),
  traceId: z.string().min(1),
  occurredAt: epochMillisSchema,
});
export interface AnnotationDeletedEventDataSchema extends Named<
  typeof annotationDeletedEventDataSchemaDefinition
> {}
export const annotationDeletedEventDataSchema: AnnotationDeletedEventDataSchema =
  annotationDeletedEventDataSchemaDefinition;
export type AnnotationDeletedEventData = z.infer<typeof annotationDeletedEventDataSchema>;

/** A score definition's name, first seen; soft deletion keeps it, so old results still resolve. */
const annotationScoreDefinedEventDataSchemaDefinition = z.object({
  scoreId: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string(),
  occurredAt: epochMillisSchema,
  backfilled: z.boolean().optional(),
});
export interface AnnotationScoreDefinedEventDataSchema extends Named<
  typeof annotationScoreDefinedEventDataSchemaDefinition
> {}
export const annotationScoreDefinedEventDataSchema: AnnotationScoreDefinedEventDataSchema =
  annotationScoreDefinedEventDataSchemaDefinition;
export type AnnotationScoreDefinedEventData = z.infer<typeof annotationScoreDefinedEventDataSchema>;

/** A score definition took a new name; results recorded under its id read the new one. */
const annotationScoreRenamedEventDataSchemaDefinition = z.object({
  scoreId: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string(),
  previousName: z.string(),
  occurredAt: epochMillisSchema,
});
export interface AnnotationScoreRenamedEventDataSchema extends Named<
  typeof annotationScoreRenamedEventDataSchemaDefinition
> {}
export const annotationScoreRenamedEventDataSchema: AnnotationScoreRenamedEventDataSchema =
  annotationScoreRenamedEventDataSchemaDefinition;
export type AnnotationScoreRenamedEventData = z.infer<typeof annotationScoreRenamedEventDataSchema>;
