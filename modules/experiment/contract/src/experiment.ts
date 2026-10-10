import type { Named } from "@langwatch/module";
import { z } from "zod";

export const EXPERIMENT_TYPES = [
  "DSPY",
  "BATCH_EVALUATION",
  "BATCH_EVALUATION_V2",
  "EVALUATIONS_V3",
] as const;

export const experimentTypeSchema = z.enum(EXPERIMENT_TYPES);
export type ExperimentType = z.infer<typeof experimentTypeSchema>;

const experimentSchemaDefinition = z.object({
  id: z.string(),
  name: z.string().nullable(),
  type: experimentTypeSchema,
  slug: z.string(),
  projectId: z.string(),
  workflowId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  archivedAt: z.date().nullable(),
  workbenchState: z.json().nullable(),
  /**
   * The monotonic counter behind the workbench compare-and-set. Every accepted
   * write bumps it by one, and a writer names the version it read so a write
   * against a stale one is refused. Rows that predate the counter read 0.
   */
  workbenchVersion: z.number(),
});
export interface ExperimentSchema extends Named<typeof experimentSchemaDefinition> {}
export const experimentSchema: ExperimentSchema = experimentSchemaDefinition;
export type Experiment = z.infer<typeof experimentSchema>;

const experimentLookupSchemaDefinition = z.object({
  projectId: z.string(),
  id: z.string(),
});
export interface ExperimentLookupSchema extends Named<typeof experimentLookupSchemaDefinition> {}
export const experimentLookupSchema: ExperimentLookupSchema = experimentLookupSchemaDefinition;
export type ExperimentLookup = z.infer<typeof experimentLookupSchema>;

const experimentSlugLookupSchemaDefinition = z.object({
  projectId: z.string(),
  slug: z.string(),
});
export interface ExperimentSlugLookupSchema extends Named<
  typeof experimentSlugLookupSchemaDefinition
> {}
export const experimentSlugLookupSchema: ExperimentSlugLookupSchema =
  experimentSlugLookupSchemaDefinition;
export type ExperimentSlugLookup = z.infer<typeof experimentSlugLookupSchema>;

const experimentPageInputSchemaDefinition = z.object({
  projectId: z.string(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(200),
});
export interface ExperimentPageInputSchema extends Named<
  typeof experimentPageInputSchemaDefinition
> {}
export const experimentPageInputSchema: ExperimentPageInputSchema =
  experimentPageInputSchemaDefinition;
export type ExperimentPageInput = z.infer<typeof experimentPageInputSchema>;

const experimentPageSchemaDefinition = z.object({
  experiments: z.array(experimentSchema),
  totalHits: z.number().int().nonnegative(),
});
export interface ExperimentPageSchema extends Named<typeof experimentPageSchemaDefinition> {}
export const experimentPageSchema: ExperimentPageSchema = experimentPageSchemaDefinition;
export type ExperimentPage = z.infer<typeof experimentPageSchema>;

const saveExperimentInputSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().nullable(),
  type: experimentTypeSchema,
  requestedSlug: z.string().min(1),
  slugMode: z.enum(["deduplicate", "preserve-existing"]),
  workflowId: z.string().nullable().optional(),
  workbenchState: z.json().nullable(),
});
export interface SaveExperimentInputSchema extends Named<
  typeof saveExperimentInputSchemaDefinition
> {}
export const saveExperimentInputSchema: SaveExperimentInputSchema =
  saveExperimentInputSchemaDefinition;
export type SaveExperimentInput = z.infer<typeof saveExperimentInputSchema>;

const findOrCreateWorkflowExperimentInputSchemaDefinition = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  name: z.string().min(1),
  workbenchState: z.json(),
});
export interface FindOrCreateWorkflowExperimentInputSchema extends Named<
  typeof findOrCreateWorkflowExperimentInputSchemaDefinition
> {}
export const findOrCreateWorkflowExperimentInputSchema: FindOrCreateWorkflowExperimentInputSchema =
  findOrCreateWorkflowExperimentInputSchemaDefinition;
export type FindOrCreateWorkflowExperimentInput = z.infer<
  typeof findOrCreateWorkflowExperimentInputSchema
>;
