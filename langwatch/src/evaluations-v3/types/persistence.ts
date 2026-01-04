import { z } from "zod";
import type { EvaluationsV3State } from "../types";
import {
  datasetReferenceSchema,
  evaluatorConfigSchema,
  targetConfigSchema,
} from "../types";

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
 * Zod schema for persisted evaluations v3 state validation.
 * Reuses schemas from types.ts (single source of truth).
 */
export const persistedEvaluationsV3StateSchema = z.object({
  experimentId: z.string().optional(),
  experimentSlug: z.string().optional(),
  name: z.string(),
  datasets: z.array(datasetReferenceSchema),
  activeDatasetId: z.string(),
  evaluators: z.array(evaluatorConfigSchema),
  targets: z.array(targetConfigSchema),
});

export type ValidatedPersistedState = z.infer<
  typeof persistedEvaluationsV3StateSchema
>;
