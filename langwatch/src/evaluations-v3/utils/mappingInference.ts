/**
 * Mapping Inference Utility for Evaluations V3
 *
 * Provides automatic inference of mappings between runner/evaluator inputs
 * and dataset columns based on name matching and semantic equivalents.
 *
 * This implements a heuristic-based approach:
 * 1. Exact name matches take priority
 * 2. Semantic equivalents from a predefined dictionary
 * 3. Cross-dataset propagation from existing mappings
 */

import type {
  DatasetColumn,
  DatasetReference,
  FieldMapping,
  RunnerConfig,
  EvaluatorConfig,
} from "../types";
import type { Field } from "~/optimization_studio/types/dsl";

// ============================================================================
// Semantic Mapping Dictionary
// ============================================================================

/**
 * Maps common field names to their semantic equivalents.
 * Key = canonical name, Value = array of equivalent names
 *
 * This dictionary is used bidirectionally:
 * - input -> question, user_input, user_query, query
 * - question -> input
 */
export const SEMANTIC_EQUIVALENTS: Record<string, string[]> = {
  // Input-related
  input: ["question", "user_input", "user_query", "query", "prompt", "message"],
  question: ["input", "user_input", "user_query", "query", "prompt"],
  user_input: ["input", "question", "query"],
  query: ["input", "question", "user_input"],

  // Output-related
  output: ["answer", "response", "result", "completion", "generated"],
  answer: ["output", "response", "result"],
  response: ["output", "answer", "result"],
  result: ["output", "answer", "response"],

  // Expected output / ground truth
  expected_output: [
    "expected_answer",
    "ground_truth",
    "expected",
    "expected_result",
    "label",
    "target",
  ],
  expected_answer: ["expected_output", "ground_truth", "expected"],
  ground_truth: ["expected_output", "expected_answer", "expected"],
  expected: ["expected_output", "expected_answer", "ground_truth"],

  // Context-related
  context: ["contexts", "retrieved_contexts", "relevant_context"],
  contexts: ["context", "retrieved_contexts"],
  retrieved_contexts: ["contexts", "context"],
};

/**
 * Build a reverse lookup map: equivalent_name -> canonical_name(s)
 */
const buildReverseLookup = (): Map<string, Set<string>> => {
  const reverseLookup = new Map<string, Set<string>>();

  for (const [canonical, equivalents] of Object.entries(SEMANTIC_EQUIVALENTS)) {
    for (const equivalent of equivalents) {
      if (!reverseLookup.has(equivalent)) {
        reverseLookup.set(equivalent, new Set());
      }
      reverseLookup.get(equivalent)!.add(canonical);
    }
    // Also add the canonical name itself
    if (!reverseLookup.has(canonical)) {
      reverseLookup.set(canonical, new Set());
    }
    reverseLookup.get(canonical)!.add(canonical);
  }

  return reverseLookup;
};

const REVERSE_SEMANTIC_LOOKUP = buildReverseLookup();

// ============================================================================
// Inference Functions
// ============================================================================

/**
 * Find the best matching column for a field in a dataset.
 *
 * Priority:
 * 1. Exact name match (case-insensitive)
 * 2. Semantic equivalent match
 *
 * @returns The matching column name, or undefined if no match found
 */
export const findMatchingColumn = (
  fieldName: string,
  columns: DatasetColumn[]
): string | undefined => {
  const columnNames = columns.map((c) => c.name.toLowerCase());
  const fieldLower = fieldName.toLowerCase();

  // 1. Exact match
  const exactMatch = columns.find(
    (c) => c.name.toLowerCase() === fieldLower
  );
  if (exactMatch) {
    return exactMatch.name;
  }

  // 2. Semantic equivalent match
  const equivalents = SEMANTIC_EQUIVALENTS[fieldLower] ?? [];
  // Also get canonical names that this field might be an equivalent of
  const canonicalNames = REVERSE_SEMANTIC_LOOKUP.get(fieldLower) ?? new Set();

  // Combine all potential matches
  const potentialMatches = new Set([...equivalents]);
  for (const canonical of canonicalNames) {
    const canonicalEquivalents = SEMANTIC_EQUIVALENTS[canonical] ?? [];
    for (const eq of canonicalEquivalents) {
      potentialMatches.add(eq);
    }
  }

  for (const potentialName of potentialMatches) {
    const match = columns.find(
      (c) => c.name.toLowerCase() === potentialName.toLowerCase()
    );
    if (match) {
      return match.name;
    }
  }

  return undefined;
};

/**
 * Infer mappings for a runner's input fields from a dataset.
 *
 * @param inputFields - The runner's input fields
 * @param dataset - The dataset to infer from
 * @param existingMappings - Any existing mappings to preserve
 * @returns New mappings to apply (only for fields that don't already have mappings)
 */
export const inferRunnerMappings = (
  inputFields: Field[],
  dataset: DatasetReference,
  existingMappings: Record<string, FieldMapping> = {}
): Record<string, FieldMapping> => {
  const newMappings: Record<string, FieldMapping> = {};

  for (const field of inputFields) {
    // Skip if already mapped
    if (existingMappings[field.identifier]) {
      continue;
    }

    // Try to find a matching column
    const matchingColumn = findMatchingColumn(field.identifier, dataset.columns);
    if (matchingColumn) {
      newMappings[field.identifier] = {
        type: "source",
        source: "dataset",
        sourceId: dataset.id,
        sourceField: matchingColumn,
      };
    }
  }

  return newMappings;
};

/**
 * Propagate mappings from an existing dataset to a new dataset.
 *
 * If field "question" is mapped to "input" on dataset A,
 * and dataset B has "input" or a semantic equivalent, propagate the mapping.
 *
 * @param inputFields - The runner's input fields
 * @param existingMappings - Mappings from another dataset (datasetId -> fieldName -> mapping)
 * @param newDataset - The new dataset to propagate to
 * @returns New mappings for the new dataset
 */
export const propagateMappingsToNewDataset = (
  inputFields: Field[],
  existingMappings: Record<string, Record<string, FieldMapping>>,
  newDataset: DatasetReference
): Record<string, FieldMapping> => {
  const newMappings: Record<string, FieldMapping> = {};

  for (const field of inputFields) {
    // Find an existing mapping for this field from any dataset
    let targetColumnName: string | undefined;

    for (const [, datasetMappings] of Object.entries(existingMappings)) {
      const mapping = datasetMappings[field.identifier];
      if (mapping?.type === "source" && mapping.source === "dataset") {
        // We have an existing mapping to a column name
        targetColumnName = mapping.sourceField;
        break;
      }
    }

    if (targetColumnName) {
      // Try to find this column (or semantic equivalent) in the new dataset
      const matchingColumn =
        findMatchingColumn(targetColumnName, newDataset.columns) ??
        findMatchingColumn(field.identifier, newDataset.columns);

      if (matchingColumn) {
        newMappings[field.identifier] = {
          type: "source",
          source: "dataset",
          sourceId: newDataset.id,
          sourceField: matchingColumn,
        };
      }
    } else {
      // No existing mapping - try basic inference
      const matchingColumn = findMatchingColumn(field.identifier, newDataset.columns);
      if (matchingColumn) {
        newMappings[field.identifier] = {
          type: "source",
          source: "dataset",
          sourceId: newDataset.id,
          sourceField: matchingColumn,
        };
      }
    }
  }

  return newMappings;
};

/**
 * Infer mappings for an evaluator's inputs.
 *
 * Evaluator inputs can map to:
 * - Dataset columns (e.g., expected_output)
 * - Runner outputs (e.g., output)
 *
 * @param evaluatorInputs - The evaluator's input fields
 * @param dataset - The dataset to infer from
 * @param runner - The runner whose outputs can be used
 * @param existingMappings - Any existing mappings to preserve
 * @returns New mappings to apply
 */
export const inferEvaluatorMappings = (
  evaluatorInputs: Field[],
  dataset: DatasetReference,
  runner: RunnerConfig,
  existingMappings: Record<string, FieldMapping> = {}
): Record<string, FieldMapping> => {
  const newMappings: Record<string, FieldMapping> = {};

  for (const input of evaluatorInputs) {
    // Skip if already mapped
    if (existingMappings[input.identifier]) {
      continue;
    }

    // First, try to match against runner outputs
    // This is prioritized for fields like "output" that should come from the runner
    const runnerOutputMatch = findMatchingColumn(
      input.identifier,
      runner.outputs.map((o) => ({ id: o.identifier, name: o.identifier, type: "string" as const }))
    );

    if (runnerOutputMatch) {
      newMappings[input.identifier] = {
        type: "source",
        source: "runner",
        sourceId: runner.id,
        sourceField: runnerOutputMatch,
      };
      continue;
    }

    // Then, try to match against dataset columns
    // This is for fields like "expected_output" that come from the dataset
    const datasetColumnMatch = findMatchingColumn(input.identifier, dataset.columns);
    if (datasetColumnMatch) {
      newMappings[input.identifier] = {
        type: "source",
        source: "dataset",
        sourceId: dataset.id,
        sourceField: datasetColumnMatch,
      };
    }
  }

  return newMappings;
};

/**
 * Infer all mappings for a runner across all datasets.
 *
 * @param runner - The runner to infer mappings for
 * @param datasets - All available datasets
 * @returns Updated mappings for the runner (merged with existing)
 */
export const inferAllRunnerMappings = (
  runner: RunnerConfig,
  datasets: DatasetReference[]
): Record<string, Record<string, FieldMapping>> => {
  const result = { ...runner.mappings };

  for (const dataset of datasets) {
    const existingDatasetMappings = result[dataset.id] ?? {};
    const newMappings = inferRunnerMappings(
      runner.inputs,
      dataset,
      existingDatasetMappings
    );

    if (Object.keys(newMappings).length > 0) {
      result[dataset.id] = {
        ...existingDatasetMappings,
        ...newMappings,
      };
    }
  }

  return result;
};

/**
 * Infer all mappings for an evaluator across all datasets and runners.
 *
 * @param evaluator - The evaluator to infer mappings for
 * @param datasets - All available datasets
 * @param runners - All runners that use this evaluator
 * @returns Updated mappings for the evaluator (merged with existing)
 */
export const inferAllEvaluatorMappings = (
  evaluator: EvaluatorConfig,
  datasets: DatasetReference[],
  runners: RunnerConfig[]
): Record<string, Record<string, Record<string, FieldMapping>>> => {
  const result = { ...evaluator.mappings };

  // Only infer for runners that have this evaluator
  const relatedRunners = runners.filter((r) =>
    r.evaluatorIds.includes(evaluator.id)
  );

  for (const dataset of datasets) {
    for (const runner of relatedRunners) {
      const existingMappings = result[dataset.id]?.[runner.id] ?? {};
      const newMappings = inferEvaluatorMappings(
        evaluator.inputs,
        dataset,
        runner,
        existingMappings
      );

      if (Object.keys(newMappings).length > 0) {
        if (!result[dataset.id]) {
          result[dataset.id] = {};
        }
        result[dataset.id]![runner.id] = {
          ...existingMappings,
          ...newMappings,
        };
      }
    }
  }

  return result;
};
