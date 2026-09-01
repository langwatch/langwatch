import { z } from "zod";

export const EXPERIMENT_TYPES = [
  "DSPY",
  "BATCH_EVALUATION",
  "BATCH_EVALUATION_V2",
  "EVALUATIONS_V3",
] as const;

export const experimentTypeSchema = z.enum(EXPERIMENT_TYPES);
export type ExperimentType = z.infer<typeof experimentTypeSchema>;

export const experimentSchema = z.object({
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
export type Experiment = z.infer<typeof experimentSchema>;

export const experimentLookupSchema = z.object({
  projectId: z.string(),
  id: z.string(),
});
export type ExperimentLookup = z.infer<typeof experimentLookupSchema>;

export const experimentSlugLookupSchema = z.object({
  projectId: z.string(),
  slug: z.string(),
});
export type ExperimentSlugLookup = z.infer<typeof experimentSlugLookupSchema>;

export const experimentPageInputSchema = z.object({
  projectId: z.string(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(200),
});
export type ExperimentPageInput = z.infer<typeof experimentPageInputSchema>;

export const experimentPageSchema = z.object({
  experiments: z.array(experimentSchema),
  totalHits: z.number().int().nonnegative(),
});
export type ExperimentPage = z.infer<typeof experimentPageSchema>;

export const saveExperimentInputSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().nullable(),
  type: experimentTypeSchema,
  requestedSlug: z.string().min(1),
  slugMode: z.enum(["deduplicate", "preserve-existing"]),
  workflowId: z.string().nullable().optional(),
  workbenchState: z.json().nullable(),
});
export type SaveExperimentInput = z.infer<typeof saveExperimentInputSchema>;

export const findOrCreateWorkflowExperimentInputSchema = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  name: z.string().min(1),
  workbenchState: z.json(),
});
export type FindOrCreateWorkflowExperimentInput = z.infer<
  typeof findOrCreateWorkflowExperimentInputSchema
>;
