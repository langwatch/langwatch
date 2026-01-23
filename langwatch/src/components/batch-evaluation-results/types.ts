/**
 * Types for Batch Evaluation Results visualization
 *
 * These types support both V2 evaluations (single target, tab-based evaluators)
 * and V3 evaluations (multiple targets, inline evaluators per target).
 */

import type {
  ESBatchEvaluation,
  ESBatchEvaluationTarget,
} from "~/server/experiments/types";

/**
 * Run data with color assignment for comparison mode
 */
export type ComparisonRunData = {
  runId: string;
  /** Human-readable name for display (e.g., commit message or run ID) */
  runName: string;
  color: string;
  data: BatchEvaluationData | null;
  isLoading: boolean;
};

/**
 * A single evaluator result for one row
 */
export type BatchEvaluatorResult = {
  evaluatorId: string;
  evaluatorName: string;
  status: "processed" | "skipped" | "error";
  score?: number | null;
  passed?: boolean | null;
  label?: string | null;
  details?: string | null;
  cost?: number | null;
  duration?: number | null;
  inputs?: Record<string, unknown>;
};

/**
 * Target output for one row
 */
export type BatchTargetOutput = {
  targetId: string;
  /** The predicted/output values from this target */
  output: Record<string, unknown> | null;
  /** Total cost for this target execution */
  cost: number | null;
  /** Duration in milliseconds */
  duration: number | null;
  /** Error message if execution failed */
  error: string | null;
  /** Trace ID for viewing execution details */
  traceId: string | null;
  /** Evaluator results for this target on this row */
  evaluatorResults: BatchEvaluatorResult[];
};

/**
 * A single row in the batch evaluation results table
 */
export type BatchResultRow = {
  /** Row index (0-based) */
  index: number;
  /** Dataset entry values (input columns) */
  datasetEntry: Record<string, unknown>;
  /** Target outputs keyed by target ID */
  targets: Record<string, BatchTargetOutput>;
};

/**
 * Target column definition for the table
 */
export type BatchTargetColumn = {
  id: string;
  name: string;
  type: "prompt" | "agent" | "custom" | "legacy";
  /** For prompts: the config ID */
  promptId?: string | null;
  /** For prompts: the version used */
  promptVersion?: number | null;
  /** For agents: the agent ID */
  agentId?: string | null;
  /** Model used */
  model?: string | null;
  /** Flexible metadata for comparison and analysis */
  metadata?: Record<string, string | number | boolean> | null;
  /** Output field names */
  outputFields: string[];
};

/**
 * Dataset column definition
 */
export type BatchDatasetColumn = {
  name: string;
  /** Whether this column might contain image URLs */
  hasImages: boolean;
};

/**
 * Complete transformed batch evaluation data ready for display
 */
export type BatchEvaluationData = {
  /** Run metadata */
  runId: string;
  experimentId: string;
  projectId: string;
  /** Timestamps */
  createdAt: number;
  finishedAt?: number | null;
  stoppedAt?: number | null;
  /** Progress for running evaluations */
  progress?: number | null;
  total?: number | null;
  /** Column definitions */
  datasetColumns: BatchDatasetColumn[];
  targetColumns: BatchTargetColumn[];
  /** All evaluator IDs used in this run */
  evaluatorIds: string[];
  /** Map of evaluator ID to display name */
  evaluatorNames: Record<string, string>;
  /** Row data */
  rows: BatchResultRow[];
};

/**
 * Transforms raw ESBatchEvaluation data into the row-based format
 * needed for TanStack Table display.
 */
export const transformBatchEvaluationData = (
  data: ESBatchEvaluation,
): BatchEvaluationData => {
  const {
    project_id,
    experiment_id,
    run_id,
    dataset,
    evaluations,
    targets,
    timestamps,
    progress,
    total,
  } = data;

  // Detect dataset columns from all entries
  const datasetColumnSet = new Set<string>();
  for (const entry of dataset) {
    for (const key of Object.keys(entry.entry ?? {})) {
      datasetColumnSet.add(key);
    }
  }

  // Check for image URLs in dataset entries for each column
  const datasetColumns: BatchDatasetColumn[] = Array.from(datasetColumnSet).map(
    (name) => ({
      name,
      hasImages: detectHasImages(dataset, name),
    }),
  );

  // Build target columns
  // For V3: use targets array
  // For V2: create a single "legacy" target from predicted columns
  // For API evaluations without targets/predicted: derive a virtual target
  let targetColumns: BatchTargetColumn[] = [];

  // Check if there are row-level errors without any target_id
  const hasRowLevelErrorsWithoutTarget = dataset.some(
    (entry) => entry.error && !entry.target_id,
  );

  if (targets && targets.length > 0) {
    // V3 style with explicit targets
    targetColumns = targets.map((target) => ({
      id: target.id,
      name: target.name,
      type: target.type === "custom" ? "custom" : target.type,
      promptId: target.prompt_id,
      promptVersion: target.prompt_version,
      agentId: target.agent_id,
      model: target.model,
      metadata: target.metadata,
      outputFields: detectOutputFields(dataset, target.id),
    }));
  } else {
    // V2 style: infer from predicted columns
    // Retrocompatibility: handle old format where predicted is flat vs nested
    const predictedColumns = detectPredictedColumns(dataset);
    if (Object.keys(predictedColumns).length > 0) {
      targetColumns = Object.entries(predictedColumns).map(
        ([node, fields]) => ({
          id: node || "output",
          name: node === "end" || node === "" ? "Output" : node,
          type: "legacy" as const,
          outputFields: Array.from(fields),
        }),
      );
    } else if (evaluations.length > 0) {
      // API evaluations: no targets, no predicted - create one virtual target per evaluator
      // Each evaluator's inputs (data=) will be displayed as the target output
      const uniqueEvaluators = new Map<string, string>();
      for (const evaluation of evaluations) {
        if (!uniqueEvaluators.has(evaluation.evaluator)) {
          uniqueEvaluators.set(
            evaluation.evaluator,
            evaluation.name ?? evaluation.evaluator,
          );
        }
      }

      // Create a virtual target for each evaluator
      targetColumns = Array.from(uniqueEvaluators.entries()).map(
        ([evaluatorId, evaluatorName]) => ({
          id: `_eval_${evaluatorId}`,
          name: evaluatorName,
          type: "legacy" as const,
          outputFields: detectEvaluatorOutputFieldsForEvaluator(
            evaluations,
            evaluatorId,
          ),
        }),
      );
    } else if (hasRowLevelErrorsWithoutTarget) {
      // SDK evaluations with errors but no targets defined - create a virtual "Output" target
      // This ensures errors are visible in the table
      targetColumns = [
        {
          id: "_default",
          name: "Output",
          type: "custom" as const,
          outputFields: [],
        },
      ];
    }
  }

  // Build evaluator info
  const evaluatorMap = new Map<string, string>();
  for (const evaluation of evaluations) {
    const key = evaluation.target_id
      ? `${evaluation.target_id}:${evaluation.evaluator}`
      : evaluation.evaluator;
    if (!evaluatorMap.has(key)) {
      evaluatorMap.set(key, evaluation.name ?? evaluation.evaluator);
    }
  }

  // Group dataset by index
  const datasetByIndex = new Map<number, (typeof dataset)[number]>();
  for (const entry of dataset) {
    // For V3, we might have multiple entries per index (one per target)
    // We need to handle this appropriately
    if (!datasetByIndex.has(entry.index) || !entry.target_id) {
      datasetByIndex.set(entry.index, entry);
    }
  }

  // Group evaluations by index and target
  const evaluationsByIndexAndTarget = new Map<
    string,
    (typeof evaluations)[number][]
  >();
  for (const evaluation of evaluations) {
    const key = `${evaluation.index}:${evaluation.target_id ?? ""}`;
    const existing = evaluationsByIndexAndTarget.get(key) ?? [];
    existing.push(evaluation);
    evaluationsByIndexAndTarget.set(key, existing);
  }

  // Group dataset entries by index and target for V3
  const datasetByIndexAndTarget = new Map<string, (typeof dataset)[number]>();
  for (const entry of dataset) {
    const key = `${entry.index}:${entry.target_id ?? ""}`;
    datasetByIndexAndTarget.set(key, entry);
  }

  // Determine the total number of rows
  // When dataset is empty, rowCount should be 0
  const rowCount =
    dataset.length > 0 ? Math.max(...dataset.map((d) => d.index)) + 1 : 0;

  // Build rows
  const rows: BatchResultRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    const baseEntry = datasetByIndex.get(i);
    const datasetEntry = baseEntry?.entry ?? {};

    // Build targets for this row
    const rowTargets: Record<string, BatchTargetOutput> = {};

    for (const targetCol of targetColumns) {
      const targetId = targetCol.id;

      // Get dataset entry for this target (V3) or base entry (V2)
      const targetEntry =
        targets && targets.length > 0
          ? (datasetByIndexAndTarget.get(`${i}:${targetId}`) ?? baseEntry)
          : baseEntry;

      // Extract output for this target
      let output: Record<string, unknown> | null = null;

      if (targetId.startsWith("_eval_")) {
        // Virtual evaluator target: extract output from this specific evaluator's inputs
        const evaluatorId = targetId.slice(6); // Remove "_eval_" prefix
        const rowEvaluations = evaluationsByIndexAndTarget.get(`${i}:`) ?? [];
        output = extractOutputFromEvaluatorInputsForEvaluator(
          rowEvaluations,
          evaluatorId,
        );
      } else if (targetEntry?.predicted) {
        if (targets && targets.length > 0) {
          // V3: predicted is the output for this target
          output = targetEntry.predicted;
        } else {
          // V2: predicted might be nested by node or flat
          const predicted = targetEntry.predicted as Record<string, unknown>;
          if (targetId === "output" || targetId === "end" || targetId === "") {
            // Check if it's flat (V2 old style) or nested
            const isNested = Object.values(predicted).some(
              (v) => typeof v === "object" && v !== null && !Array.isArray(v),
            );
            if (isNested && targetId in predicted) {
              output = predicted[targetId] as Record<string, unknown>;
            } else if (!isNested) {
              output = predicted;
            } else {
              output = (predicted.end as Record<string, unknown>) ?? predicted;
            }
          } else if (targetId in predicted) {
            output = predicted[targetId] as Record<string, unknown>;
          }
        }
      }

      // Get evaluator results for this target
      let targetEvaluations: (typeof evaluations)[number][];

      if (targetId.startsWith("_eval_")) {
        // Virtual evaluator target: only include this specific evaluator
        const evaluatorId = targetId.slice(6);
        const rowEvaluations = evaluationsByIndexAndTarget.get(`${i}:`) ?? [];
        targetEvaluations = rowEvaluations.filter(
          (ev) => ev.evaluator === evaluatorId,
        );
      } else {
        targetEvaluations =
          evaluationsByIndexAndTarget.get(`${i}:${targetId}`) ??
          (targets && targets.length > 0
            ? []
            : (evaluationsByIndexAndTarget.get(`${i}:`) ?? []));
      }

      const evaluatorResults: BatchEvaluatorResult[] = targetEvaluations.map(
        (ev) => ({
          evaluatorId: ev.evaluator,
          evaluatorName: ev.name ?? ev.evaluator,
          status: ev.status,
          score: ev.score,
          passed: ev.passed,
          label: ev.label,
          details: ev.details,
          cost: ev.cost,
          duration: ev.duration,
          inputs: ev.inputs,
        }),
      );

      rowTargets[targetId] = {
        targetId,
        output,
        cost: targetEntry?.cost ?? null,
        duration: targetEntry?.duration ?? null,
        error: targetEntry?.error ?? null,
        traceId: targetEntry?.trace_id ?? null,
        evaluatorResults,
      };
    }

    rows.push({
      index: i,
      datasetEntry,
      targets: rowTargets,
    });
  }

  return {
    runId: run_id,
    experimentId: experiment_id,
    projectId: project_id,
    createdAt: timestamps.created_at,
    finishedAt: timestamps.finished_at,
    stoppedAt: timestamps.stopped_at,
    progress,
    total,
    datasetColumns,
    targetColumns,
    evaluatorIds: Array.from(evaluatorMap.keys()),
    evaluatorNames: Object.fromEntries(evaluatorMap),
    rows,
  };
};

/**
 * Detect output fields for a specific target from the dataset
 */
const detectOutputFields = (
  dataset: ESBatchEvaluation["dataset"],
  targetId: string,
): string[] => {
  const fields = new Set<string>();
  for (const entry of dataset) {
    if (entry.target_id === targetId && entry.predicted) {
      for (const key of Object.keys(entry.predicted)) {
        fields.add(key);
      }
    }
  }
  return Array.from(fields);
};

/**
 * Detect output fields from evaluator inputs for a specific evaluator
 * Used when creating virtual targets per evaluator for API evaluations
 */
const detectEvaluatorOutputFieldsForEvaluator = (
  evaluations: ESBatchEvaluation["evaluations"],
  evaluatorId: string,
): string[] => {
  const fields = new Set<string>();
  for (const evaluation of evaluations) {
    if (evaluation.evaluator === evaluatorId && evaluation.inputs) {
      // Add all input fields - we'll display the full data
      for (const key of Object.keys(evaluation.inputs)) {
        fields.add(key);
      }
    }
  }
  // Default to "data" if no fields found
  if (fields.size === 0) {
    fields.add("data");
  }
  return Array.from(fields);
};

/**
 * Extract output from evaluator inputs for a specific evaluator
 * Returns all inputs as the "output" for display
 */
const extractOutputFromEvaluatorInputsForEvaluator = (
  evaluations: ESBatchEvaluation["evaluations"],
  evaluatorId: string,
): Record<string, unknown> | null => {
  for (const evaluation of evaluations) {
    if (evaluation.evaluator !== evaluatorId) continue;
    if (!evaluation.inputs) continue;

    const inputs = evaluation.inputs;
    const keys = Object.keys(inputs);

    // If there's only one key and it's a common output field, unwrap it
    if (keys.length === 1) {
      const key = keys[0]!;
      if (
        key === "output" ||
        key === "response" ||
        key === "generated" ||
        key === "answer" ||
        key === "prediction"
      ) {
        return { output: inputs[key] };
      }
    }

    // Otherwise return all inputs as-is (will be displayed as JSON)
    if (keys.length > 0) {
      return inputs as Record<string, unknown>;
    }
  }

  return null;
};

/**
 * Detect predicted columns for V2 style data
 * Returns a map of node name to field names
 */
const detectPredictedColumns = (
  dataset: ESBatchEvaluation["dataset"],
): Record<string, Set<string>> => {
  const columns: Record<string, Set<string>> = {};

  // Check if predicted values are flat or nested
  const firstPredicted = dataset.find((d) => d.predicted)?.predicted;
  if (!firstPredicted) return columns;

  const isNested = Object.values(firstPredicted).every(
    (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  );

  if (isNested) {
    // Nested format: { node: { field: value } }
    for (const entry of dataset) {
      if (!entry.predicted) continue;
      for (const [node, value] of Object.entries(entry.predicted)) {
        if (
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value)
        ) {
          if (!columns[node]) columns[node] = new Set();
          for (const key of Object.keys(value)) {
            columns[node]!.add(key);
          }
        }
      }
    }
  } else {
    // Flat format: { field: value }
    columns.end = new Set();
    for (const entry of dataset) {
      if (!entry.predicted) continue;
      for (const key of Object.keys(entry.predicted)) {
        columns.end!.add(key);
      }
    }
  }

  return columns;
};

/**
 * Detect if a column might contain image URLs based on all entries
 */
const detectHasImages = (
  dataset: ESBatchEvaluation["dataset"],
  columnName: string,
): boolean => {
  // Check up to first 10 entries for image URLs
  const samplesToCheck = dataset.slice(0, 10);
  for (const entry of samplesToCheck) {
    const value = entry.entry?.[columnName];
    if (typeof value === "string" && isImageUrlHeuristic(value)) {
      return true;
    }
  }
  return false;
};

/**
 * Simple heuristic to detect if a string is an image URL
 */
export const isImageUrlHeuristic = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  // Check for common image extensions or data URLs
  return (
    /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?.*)?$/i.test(value) ||
    value.startsWith("data:image/") ||
    value.includes("/images/") ||
    value.includes("cloudinary") ||
    value.includes("imgur")
  );
};
