/**
 * Mapping Inference Utility for Evaluations V3
 */

import type { Field } from "@langwatch/workflow-contract";

import type {
  ComparisonEvaluatorConfig,
  DatasetColumn,
  DatasetReference,
  EvaluatorConfig,
  FieldMapping,
  TargetConfig,
} from "../experiment-workbench.ts";

// ============================================================================
// Semantic Mapping Dictionary
// ============================================================================

/**
 * Maps common field names to their semantic equivalents. Key = canonical name, Value =
 * array of equivalent names
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
 * Normalize a name to a canonical form for comparison. Converts both camelCase and
 * snake_case to lowercase with no separators.
 */
export const normalizeForComparison = (name: string): string => {
  return name
    .replace(/_/g, "") // Remove underscores (snake_case)
    .toLowerCase(); // Lowercase (also handles camelCase)
};

/**
 * Find the best matching column for a field in a dataset.
 * @returns The matching column name, or undefined if no match found
 */
export const findMatchingColumn = (
  fieldName: string,
  columns: DatasetColumn[],
): string | undefined => {
  const _columnNames = columns.map((c) => c.name.toLowerCase());
  const fieldLower = fieldName.toLowerCase();

  // 1. Exact match (case-insensitive)
  const exactMatch = columns.find((c) => c.name.toLowerCase() === fieldLower);
  if (exactMatch) {
    return exactMatch.name;
  }

  // 2. Normalized match (camelCase/snake_case equivalence)
  // e.g., "threadId" matches "thread_id"
  const fieldNormalized = normalizeForComparison(fieldName);
  const normalizedMatch = columns.find((c) => normalizeForComparison(c.name) === fieldNormalized);
  if (normalizedMatch) {
    return normalizedMatch.name;
  }

  // 3. Semantic equivalent match
  const equivalents = SEMANTIC_EQUIVALENTS[fieldLower] ?? [];
  // Also get canonical names that this field might be an equivalent of
  const canonicalNames = REVERSE_SEMANTIC_LOOKUP.get(fieldLower) ?? new Set();

  // Combine all potential matches
  const potentialMatches = new Set(equivalents);
  for (const canonical of canonicalNames) {
    const canonicalEquivalents = SEMANTIC_EQUIVALENTS[canonical] ?? [];
    for (const eq of canonicalEquivalents) {
      potentialMatches.add(eq);
    }
  }

  for (const potentialName of potentialMatches) {
    const match = columns.find((c) => c.name.toLowerCase() === potentialName.toLowerCase());
    if (match) {
      return match.name;
    }
  }

  return undefined;
};

/**
 * Infers new mappings for the target's input fields against `dataset`, skipping any
 * field already present in `existingMappings`.
 */
export const inferTargetMappings = (
  inputFields: Field[],
  dataset: DatasetReference,
  existingMappings: Record<string, FieldMapping> = {},
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
 * Carries `inputFields`' existing column mappings (from any prior dataset) over to
 * `newDataset`, re-resolving each target column against its columns.
 */
export const propagateMappingsToNewDataset = (
  inputFields: Field[],
  existingMappings: Record<string, Record<string, FieldMapping>>,
  newDataset: DatasetReference,
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

    // The previously mapped column (or a semantic equivalent) first, then basic inference
    const matchingColumn =
      (targetColumnName ? findMatchingColumn(targetColumnName, newDataset.columns) : undefined) ??
      findMatchingColumn(field.identifier, newDataset.columns);
    if (matchingColumn) {
      newMappings[field.identifier] = {
        type: "source",
        source: "dataset",
        sourceId: newDataset.id,
        sourceField: matchingColumn,
      };
    }
  }

  return newMappings;
};

/**
 * Identifiers whose only sensible source is the runner/target output.
 */
const TARGET_OUTPUT_FIELDS = new Set(["output", "response", "answer", "result", "generated"]);

/**
 * Identifiers whose only sensible source is the dataset.
 */
const DATASET_INPUT_FIELDS = new Set([
  // Input family (the prompt's input)
  "input",
  "question",
  "user_input",
  "user_query",
  "query",
  "prompt",
  "message",
  // Expected family (the golden answer)
  "expected_output",
  "expected_answer",
  "ground_truth",
  "expected",
  "expected_result",
  // Context family (retrieval / supporting facts)
  "context",
  "contexts",
  "retrieved_contexts",
  "relevant_context",
]);

/**
 * One evaluator input's source: output-like fields read only the target (a lone
 * output stands in for a name match), input-like only the dataset, anything else
 * the dataset then the target. Empty beats grading the dataset against itself.
 */
const inferEvaluatorInputSource = ({
  identifier,
  dataset,
  target,
}: {
  identifier: string;
  dataset: DatasetReference;
  target: TargetConfig;
}): FieldMapping | undefined => {
  const fieldLower = identifier.toLowerCase();
  const fromTarget = (): FieldMapping | undefined => {
    const field = findMatchingColumn(
      identifier,
      target.outputs.map((o) => ({
        id: o.identifier,
        name: o.identifier,
        type: "string" as const,
      })),
    );
    return field
      ? { type: "source", source: "target", sourceId: target.id, sourceField: field }
      : undefined;
  };
  const fromDataset = (): FieldMapping | undefined => {
    const field = findMatchingColumn(identifier, dataset.columns);
    return field
      ? { type: "source", source: "dataset", sourceId: dataset.id, sourceField: field }
      : undefined;
  };

  if (TARGET_OUTPUT_FIELDS.has(fieldLower)) {
    const soleOutput = target.outputs.length === 1 ? target.outputs[0]?.identifier : undefined;
    return (
      fromTarget() ??
      (soleOutput
        ? { type: "source", source: "target", sourceId: target.id, sourceField: soleOutput }
        : undefined)
    );
  }
  if (DATASET_INPUT_FIELDS.has(fieldLower)) return fromDataset();

  return fromDataset() ?? fromTarget();
};

/**
 * Infers new mappings for the evaluator's input fields, preferring `target`'s outputs
 * or `dataset`'s columns depending on the field, and skipping already-mapped fields.
 */
export const inferEvaluatorMappings = ({
  evaluatorInputs,
  dataset,
  target,
  existingMappings = {},
}: {
  evaluatorInputs: Field[];
  dataset: DatasetReference;
  target: TargetConfig;
  existingMappings?: Record<string, FieldMapping>;
}): Record<string, FieldMapping> => {
  const newMappings: Record<string, FieldMapping> = {};
  for (const input of evaluatorInputs) {
    if (existingMappings[input.identifier]) continue;
    const mapping = inferEvaluatorInputSource({ identifier: input.identifier, dataset, target });
    if (mapping) newMappings[input.identifier] = mapping;
  }
  return newMappings;
};

/**
 * @param target - The target to infer mappings for
 * @param datasets - All available datasets
 * @returns Updated mappings for the target (merged with existing)
 */
export const inferAllTargetMappings = (
  target: TargetConfig,
  datasets: DatasetReference[],
): Record<string, Record<string, FieldMapping>> => {
  const result = { ...target.mappings };

  for (const dataset of datasets) {
    const existingDatasetMappings = result[dataset.id] ?? {};
    const newMappings = inferTargetMappings(target.inputs, dataset, existingDatasetMappings);

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
 * Infers mappings for `evaluator` across every target and dataset it's used with,
 * merging the result into its existing mappings.
 */
export const inferAllEvaluatorMappings = (
  evaluator: EvaluatorConfig,
  datasets: DatasetReference[],
  targets: TargetConfig[],
): Record<string, Record<string, Record<string, FieldMapping>>> => {
  const result = { ...evaluator.mappings };

  // All evaluators apply to all targets, so infer for every combination
  for (const dataset of datasets) {
    for (const target of targets) {
      const existingMappings = result[dataset.id]?.[target.id] ?? {};
      const newMappings = inferEvaluatorMappings({
        evaluatorInputs: evaluator.inputs,
        dataset,
        target,
        existingMappings,
      });

      if (Object.keys(newMappings).length > 0) {
        // Copy the per-dataset bucket before writing into it: `result` is a
        // shallow copy of the evaluator's mappings, so assigning straight into
        // it would edit the caller's own state object.
        result[dataset.id] = { ...result[dataset.id] };
        result[dataset.id]![target.id] = {
          ...existingMappings,
          ...newMappings,
        };
      }
    }
  }

  return result;
};

/**
 * Derive per-row field mappings for a column-style comparison evaluator target from its
 * high-level comparison config.
 */
export const deriveComparisonTargetMappings = (
  comparison: ComparisonEvaluatorConfig,
  dataset: DatasetReference | undefined,
): Record<string, FieldMapping> => {
  const mappings: Record<string, FieldMapping> = {};
  if (!dataset) return mappings;

  // Explicit input context wins; otherwise auto-map "input" to the most
  // likely dataset column so the user doesn't have to re-pick something
  // obvious. Skips when there's no plausible match — `input` is optional.
  const inputColumn = comparison.inputField ?? findMatchingColumn("input", dataset.columns);
  if (inputColumn) {
    mappings.input = {
      type: "source",
      source: "dataset",
      sourceId: dataset.id,
      sourceField: inputColumn,
    };
  }

  if (comparison.goldenField) {
    mappings.golden = {
      type: "source",
      source: "dataset",
      sourceId: dataset.id,
      sourceField: comparison.goldenField,
    };
  }

  return mappings;
};
