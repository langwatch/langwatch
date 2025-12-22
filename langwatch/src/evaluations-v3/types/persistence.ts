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
  source: z.enum(["dataset", "agent"]),
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
 * Zod schema for LLM config validation.
 */
const llmConfigSchema = z.object({
  model: z.string(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  top_p: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  litellm_params: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

/**
 * Zod schema for chat message validation.
 * Uses unknown for content to handle rich content types.
 */
const chatMessageSchema = z.object({
  role: z.string().optional(),
  content: z.unknown(),
}).passthrough();

/**
 * Zod schema for agent config validation.
 */
const agentConfigSchema = z.object({
  id: z.string(),
  type: z.enum(["llm", "code"]),
  name: z.string(),
  icon: z.string().optional(),
  llmConfig: llmConfigSchema.optional(),
  messages: z.array(chatMessageSchema).optional(),
  instructions: z.string().optional(),
  code: z.string().optional(),
  inputs: z.array(fieldSchema),
  outputs: z.array(fieldSchema),
  mappings: z.record(z.string(), fieldMappingSchema),
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
  agents: z.array(agentConfigSchema),
});

export type ValidatedPersistedState = z.infer<
  typeof persistedEvaluationsV3StateSchema
>;
