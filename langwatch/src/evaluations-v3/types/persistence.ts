import { z } from "zod";
import type { EvaluationsV3State, EvaluationResults } from "../types";
import {
  datasetReferenceSchema,
  evaluatorConfigSchema,
  targetConfigSchema,
  targetRowMetadataSchema,
} from "../types";

// ============================================================================
// Zod Schemas (Single Source of Truth)
// ============================================================================

/**
 * Schema for persisted results.
 * Arrays can contain null/undefined for rows that haven't been executed.
 * Uses targetRowMetadataSchema from types.ts as single source of truth.
 */
export const persistedResultsSchema = z.object({
  runId: z.string().optional(),
  versionId: z.string().optional(),
  targetOutputs: z.record(z.array(z.unknown())),
  targetMetadata: z.record(z.array(targetRowMetadataSchema.nullish())),
  evaluatorResults: z.record(z.record(z.array(z.unknown()))),
  errors: z.record(z.array(z.string().nullish())),
});

/**
 * Zod schema for persisted evaluations v3 state validation.
 * Reuses schemas from types.ts for datasets, evaluators, targets.
 */
export const persistedEvaluationsV3StateSchema = z.object({
  experimentId: z.string().optional(),
  experimentSlug: z.string().optional(),
  name: z.string(),
  datasets: z.array(datasetReferenceSchema),
  activeDatasetId: z.string(),
  evaluators: z.array(evaluatorConfigSchema),
  targets: z.array(targetConfigSchema),
  results: persistedResultsSchema.optional(),
});

// ============================================================================
// Derived TypeScript Types (from Zod schemas)
// ============================================================================

/**
 * The results fields that get persisted to the database.
 * Excludes transient execution state (status, progress, executingCells).
 * Derived from persistedResultsSchema - keeps types in sync automatically.
 */
export type PersistedResults = z.infer<typeof persistedResultsSchema>;

/**
 * The state that gets persisted to the database.
 * Excludes transient UI state and execution-only result fields.
 */
export type PersistedEvaluationsV3State = Omit<
  EvaluationsV3State,
  "ui" | "results"
> & {
  results?: PersistedResults;
};

/**
 * Validated persisted state type - derived from schema.
 */
export type ValidatedPersistedState = z.infer<typeof persistedEvaluationsV3StateSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extracts the persistable results from the full results state.
 * Excludes transient fields like status, progress, and executingCells.
 */
const extractPersistedResults = (results: EvaluationResults): PersistedResults | undefined => {
  // Only persist if there are actual results
  const hasResults =
    Object.keys(results.targetOutputs).length > 0 ||
    Object.keys(results.targetMetadata).length > 0 ||
    Object.keys(results.evaluatorResults).length > 0 ||
    Object.keys(results.errors).length > 0;

  if (!hasResults) {
    return undefined;
  }

  return {
    runId: results.runId,
    versionId: results.versionId,
    targetOutputs: results.targetOutputs,
    targetMetadata: results.targetMetadata,
    evaluatorResults: results.evaluatorResults,
    errors: results.errors,
  };
};

/**
 * Extracts the persistable state from the full store state.
 */
export const extractPersistedState = (
  state: EvaluationsV3State
): PersistedEvaluationsV3State => {
  const { ui: _ui, results, ...restState } = state;
  const persistedResults = extractPersistedResults(results);

  return {
    ...restState,
    results: persistedResults,
  };
};
