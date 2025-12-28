import { z } from "zod";
import type { EvaluationsV3State } from "../types";

/**
 * The state that gets persisted to the database.
 * Excludes transient UI state and execution results.
 */
export type PersistedEvaluationsV3State = Omit<
  EvaluationsV3State,
  "ui" | "results"
>;

/**
 * Extracts the persistable state from the full store state.
 */
export const extractPersistedState = (
  state: EvaluationsV3State
): PersistedEvaluationsV3State => {
  const { ui: _ui, results: _results, ...persistedState } = state;
  return persistedState;
};

/**
 * Zod schema for field mapping validation.
 */
const fieldMappingSchema = z.object({
  source: z.enum(["dataset", "runner"]),
  sourceId: z.string(),
  sourceField: z.string(),
});

/**
 * Zod schema for dataset column validation.
 * Uses passthrough() to allow all DatasetColumnType values from the server.
 */
const datasetColumnSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(), // Allow any string since DatasetColumnType has many values
});

/**
 * Zod schema for inline dataset validation.
 */
const inlineDatasetSchema = z.object({
  columns: z.array(datasetColumnSchema),
  records: z.record(z.string(), z.array(z.string())),
});

/**
 * Zod schema for dataset reference validation.
 */
const datasetReferenceSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["inline", "saved"]),
  inline: inlineDatasetSchema.optional(),
  datasetId: z.string().optional(),
  columns: z.array(datasetColumnSchema),
});

/**
 * Zod schema for field validation (from optimization studio).
 */
const fieldSchema = z.object({
  identifier: z.string(),
  type: z.string(),
  value: z.unknown().optional(),
});

/**
 * Zod schema for evaluator config validation.
 */
const evaluatorConfigSchema = z.object({
  id: z.string(),
  evaluatorType: z.string(),
  name: z.string(),
  settings: z.record(z.string(), z.unknown()),
  inputs: z.array(fieldSchema),
  mappings: z.record(z.string(), z.record(z.string(), fieldMappingSchema)),
});

/**
 * Zod schema for runner config validation.
 * Runners can be either prompts (referencing saved prompts) or agents (code/workflow).
 */
const runnerConfigSchema = z.object({
  id: z.string(),
  type: z.enum(["prompt", "agent"]),
  name: z.string(),
  // For prompt type
  promptId: z.string().optional(),
  promptVersionId: z.string().optional(),
  // For agent type
  dbAgentId: z.string().optional(),
  // Common fields
  inputs: z.array(fieldSchema).optional(),
  outputs: z.array(fieldSchema).optional(),
  mappings: z.record(z.string(), fieldMappingSchema).optional(),
  evaluatorIds: z.array(z.string()),
});

/**
 * Zod schema for persisted evaluations v3 state validation.
 */
export const persistedEvaluationsV3StateSchema = z.object({
  experimentId: z.string().optional(),
  experimentSlug: z.string().optional(),
  name: z.string(),
  datasets: z.array(datasetReferenceSchema),
  activeDatasetId: z.string(),
  evaluators: z.array(evaluatorConfigSchema),
  runners: z.array(runnerConfigSchema),
});

export type ValidatedPersistedState = z.infer<
  typeof persistedEvaluationsV3StateSchema
>;
