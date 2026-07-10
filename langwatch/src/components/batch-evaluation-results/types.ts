/**
 * Types for Batch Evaluation Results visualization
 *
 * These types support both V2 evaluations (single target, tab-based evaluators)
 * and V3 evaluations (multiple targets, inline evaluators per target).
 */

import type { ExperimentRunWithItems } from "~/server/experiments-v3/services/types";

/**
 * Run data with color assignment for comparison mode
 */
export type ComparisonRunData = {
  runId: string;
  /** Human-readable name for display (e.g., commit message or run ID) */
  runName: string | React.ReactNode;
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
  type: "prompt" | "agent" | "evaluator" | "custom" | "legacy";
  /** For prompts: the config ID */
  promptId?: string | null;
  /** For prompts: the version used */
  promptVersion?: number | null;
  /** For agents: the agent ID */
  agentId?: string | null;
  /** For evaluator targets: the evaluator ID */
  evaluatorId?: string | null;
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
 * A comparison evaluator's per-row verdict, normalized to name the winner by
 * identifier. Legacy slot labels ("A" / "B" / "tie") are resolved against the
 * column's variant order at detection time, so nothing downstream sees them.
 */
export type BatchComparisonVerdict = {
  rowIndex: number;
  /**
   * Identifier of the winning variant, or null for a tie. Matches the `id` of
   * one of the column's `variants` — the internal target id where the judge's
   * label resolved to a known target, otherwise the raw label it returned.
   */
  winnerId: string | null;
  reasoning?: string | null;
  /**
   * Text of the winning variant's actual output for this row, so the row
   * cell can surface "what was right" alongside "why". Empty for a tie
   * (nothing definitively won) or when the variant's row output can't be
   * looked up (missing target / unresolved variant).
   */
  winnerOutput?: string | null;
};

/** One candidate participating in a comparison, in the order the judge saw them. */
export type BatchComparisonVariant = {
  /** Internal target id, or the raw judge label when it names no known target. */
  id: string | null;
  /** Display name — falls back to "Variant N" when the target is unknown. */
  name: string;
};

/**
 * Column definition for a comparison evaluator, whether it compares two
 * candidates or ten. One per comparison evaluator in a run; the batch results
 * table renders these AFTER the target columns.
 */
export type BatchComparisonColumn = {
  /** Evaluator id (config-level), used to key verdicts and column ids. */
  evaluatorId: string;
  /** Display name (e.g. "Comparison"). */
  name: string;
  /** Every candidate compared, in judge order. Always at least one entry. */
  variants: BatchComparisonVariant[];
  /** Per-row verdicts keyed by row index. Missing rows → no verdict. */
  verdictsByRow: Record<number, BatchComparisonVerdict>;
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
  /**
   * Comparison evaluator columns detected in this run. Empty when no
   * evaluator emitted a tie or winning-variant label. Rendered as an
   * extra "Winner" column per comparison evaluator after target columns.
   * Optional so pre-existing test literals don't have to spell it out.
   */
  comparisonColumns?: BatchComparisonColumn[];
  /** Row data */
  rows: BatchResultRow[];
};

/**
 * Transforms raw ExperimentRunWithItems data into the row-based format
 * needed for TanStack Table display.
 */
export const transformBatchEvaluationData = (
  data: ExperimentRunWithItems,
): BatchEvaluationData => {
  const {
    experimentId,
    runId,
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
    (entry) => entry.error && !entry.targetId,
  );

  if (targets && targets.length > 0) {
    // V3 style with explicit targets
    targetColumns = targets.map((target) => ({
      id: target.id,
      name: target.name,
      type: target.type === "custom" ? "custom" : (target.type as BatchTargetColumn["type"]),
      promptId: target.promptId,
      promptVersion: target.promptVersion,
      agentId: target.agentId,
      evaluatorId: target.evaluatorId,
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
    const key = evaluation.targetId
      ? `${evaluation.targetId}:${evaluation.evaluator}`
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
    if (!datasetByIndex.has(entry.index) || !entry.targetId) {
      datasetByIndex.set(entry.index, entry);
    }
  }

  // Group evaluations by index and target
  const evaluationsByIndexAndTarget = new Map<
    string,
    (typeof evaluations)[number][]
  >();
  for (const evaluation of evaluations) {
    const key = `${evaluation.index}:${evaluation.targetId ?? ""}`;
    const existing = evaluationsByIndexAndTarget.get(key) ?? [];
    existing.push(evaluation);
    evaluationsByIndexAndTarget.set(key, existing);
  }

  // Group dataset entries by index and target for V3
  const datasetByIndexAndTarget = new Map<string, (typeof dataset)[number]>();
  for (const entry of dataset) {
    const key = `${entry.index}:${entry.targetId ?? ""}`;
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
          inputs: ev.inputs ?? undefined,
        }),
      );

      rowTargets[targetId] = {
        targetId,
        output,
        cost: targetEntry?.cost ?? null,
        duration: targetEntry?.duration ?? null,
        error: targetEntry?.error ?? null,
        traceId: targetEntry?.traceId ?? null,
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
    runId,
    experimentId,
    projectId: data.projectId,
    createdAt: timestamps.createdAt,
    finishedAt: timestamps.finishedAt,
    stoppedAt: timestamps.stoppedAt,
    progress,
    total,
    datasetColumns,
    targetColumns,
    evaluatorIds: Array.from(evaluatorMap.keys()),
    evaluatorNames: Object.fromEntries(evaluatorMap),
    comparisonColumns: detectComparisonColumns(evaluations, targetColumns, rows),
    rows,
  };
};

/**
 * Peel the winning target's stored output to a display string. Handles the
 * three shapes we see in the wild:
 *   1. A plain string (single-output-field target unwrapped at storage).
 *   2. `{ output: "..." }` — the conventional flat-key shape.
 *   3. `{ output: { output: "...", confidence: "high" } }` — the double-
 *      wrap that happens when structured outputs get stored under an outer
 *      `output` key too.
 * Recurses into `.output` / `.answer` until it hits a scalar. Anything more
 * exotic than that gets JSON-stringified so the cell still shows *something*
 * instead of "[object Object]".
 */
const extractWinnerOutputText = (raw: unknown): string | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw !== "object") return String(raw);
  // Up to 3 layers of `.output` / `.answer` unwrap covers structured outputs
  // stored as `{output: {output: "..."}}` without recursing forever on
  // pathological shapes.
  let cursor: unknown = raw;
  for (let i = 0; i < 3; i++) {
    if (!cursor || typeof cursor !== "object") break;
    const asObj = cursor as Record<string, unknown>;
    const candidate = asObj.output ?? asObj.answer;
    if (typeof candidate === "string") return candidate;
    if (candidate === undefined || candidate === null) break;
    cursor = candidate;
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
};

/** Candidate ids the judge was actually called with, in judge order. */
const readCandidateIds = (inputs: Record<string, unknown>): string[] => {
  // Current contract: the orchestrator sends an ordered `candidates` list.
  const candidates = inputs.candidates;
  if (Array.isArray(candidates)) {
    return candidates
      .map((candidate) =>
        candidate && typeof candidate === "object"
          ? (candidate as { id?: unknown }).id
          : undefined,
      )
      .filter((id): id is string => typeof id === "string");
  }
  // Legacy two-slot contract, still present on runs stored before the merge.
  return [inputs.candidate_a_id, inputs.candidate_b_id].filter(
    (id): id is string => typeof id === "string",
  );
};

/**
 * Detect comparison evaluators by observing their per-row label shapes.
 *
 * A comparison evaluator's label is either the winning candidate's target id
 * or prompt handle — the current contract — or a slot letter ("A" / "B" /
 * "tie") on runs stored before pairwise and N-way were merged.
 *
 * Variant identity comes from the judge's own inputs (`candidates`, or the
 * legacy `candidate_a_id` / `candidate_b_id`), which is authoritative: it
 * names every candidate even in a run where only one of them ever won.
 * Observed winning labels are the fallback when inputs aren't populated.
 *
 * Any non-tie label that names no known target still becomes a variant of its
 * own, keyed by the raw label. Dropping it would silently under-count a
 * winner — which is exactly what the old two-slot detection did to every
 * third-and-beyond variant.
 */
const detectComparisonColumns = (
  evaluations: ExperimentRunWithItems["evaluations"],
  targetColumns: BatchTargetColumn[],
  rows: BatchResultRow[],
): BatchComparisonColumn[] => {
  const targetNameById = new Map(targetColumns.map((t) => [t.id, t.name]));
  // Langevals echoes back the variant's DISPLAY IDENTIFIER as the verdict
  // label — for prompt targets that's the prompt handle (e.g. "say-hi"), not
  // the internal `target_XYZ` id. Build a lookup that accepts either shape so
  // detection resolves either to the underlying target id.
  const targetIdByAnyKey = new Map<string, string>();
  for (const t of targetColumns) {
    targetIdByAnyKey.set(t.id, t.id);
    if (t.name) targetIdByAnyKey.set(t.name, t.id);
    if (t.promptId) targetIdByAnyKey.set(t.promptId, t.id);
  }
  const resolveToTargetId = (identifier: string): string | undefined =>
    targetIdByAnyKey.get(identifier);

  // Every target column with `type: "evaluator"` is treated as a comparison
  // column-target — the synthetic evaluator generated for it stores
  // evaluator id == target id, and no scalar evaluator ever ends up as a
  // top-level target column in this UI. Pre-populating buckets from these
  // means chip suppression + win-rate chart wire up even when the run's
  // evaluations echo an unusual label shape (dogfood: label sometimes echoes
  // an identifier we don't have in `targetColumns` — the strict shape check
  // dropped whole evaluators on the floor and both fixes silently no-op'd).
  const forcedComparisonEvaluatorIds = new Set(
    targetColumns.filter((t) => t.type === "evaluator").map((t) => t.id),
  );

  const isSlotLabel = (v: string): v is "A" | "B" | "tie" =>
    v === "A" || v === "B" || v === "tie";

  // Also treat any evaluator whose type or display name looks like a
  // comparison judge as one, even if this row's label doesn't match a known
  // target id or slot letter. Real-world dogfood found the label sometimes
  // echoes an identifier we don't have in `targetColumns` (e.g. a prompt
  // handle resolved by langevals but not reflected in the run's targets
  // snapshot), and the strict shape check silently dropped the whole
  // evaluator on the floor — chip suppression + win-rate chart both no-op'd.
  const isComparisonEvaluator = (
    ev: ExperimentRunWithItems["evaluations"][number],
  ) => {
    const fields = [ev.evaluator ?? "", ev.name ?? ""].map((f) =>
      f.toLowerCase(),
    );
    return fields.some(
      (field) =>
        field.includes("pairwise") ||
        field.includes("select_best") ||
        field.includes("comparison"),
    );
  };

  // Group by evaluator id + name so different comparison instances (same
  // evaluator type wired against different variant sets) stay separate.
  const buckets = new Map<
    string,
    {
      evaluatorId: string;
      name: string;
      /** First-seen judge order of the candidates, from the judge's inputs. */
      candidateIds: string[];
      /** Non-tie labels observed as winners, in first-seen order. */
      winningLabels: string[];
      sawSlotLabels: boolean;
      verdicts: Array<{
        rowIndex: number;
        rawLabel: string;
        reasoning: string | null;
      }>;
    }
  >();

  for (const ev of evaluations) {
    if (ev.status !== "processed") continue;
    const isForced = forcedComparisonEvaluatorIds.has(ev.evaluator);
    const hasLabel = typeof ev.label === "string" && ev.label.length > 0;
    if (!hasLabel && !isComparisonEvaluator(ev) && !isForced) continue;

    const label = ev.label ?? "";
    if (
      hasLabel &&
      !isSlotLabel(label) &&
      !resolveToTargetId(label) &&
      !isComparisonEvaluator(ev) &&
      !isForced
    ) {
      continue;
    }

    const key = ev.name ? `${ev.evaluator}::${ev.name}` : ev.evaluator;
    let bucket = buckets.get(key);
    if (!bucket) {
      // Prefer the target column's display name when the evaluator id matches
      // a column-target (comparison column-target case) — this keeps the chart
      // / winner column labeled "Comparison" instead of the raw `target_XYZ`
      // id when ev.name is null.
      bucket = {
        evaluatorId: ev.evaluator,
        name: ev.name ?? targetNameById.get(ev.evaluator) ?? ev.evaluator,
        candidateIds: [],
        winningLabels: [],
        sawSlotLabels: false,
        verdicts: [],
      };
      buckets.set(key, bucket);
    }

    // Snapshot the judge's own view of who it compared. Authoritative: it
    // names every candidate even when only one of them ever wins.
    for (const id of readCandidateIds((ev.inputs ?? {}) as Record<string, unknown>)) {
      const resolved = resolveToTargetId(id) ?? id;
      if (!bucket.candidateIds.includes(resolved)) {
        bucket.candidateIds.push(resolved);
      }
    }

    if (!hasLabel) continue;
    if (isSlotLabel(label)) {
      bucket.sawSlotLabels = true;
    } else {
      const resolved = resolveToTargetId(label) ?? label;
      if (!bucket.winningLabels.includes(resolved)) {
        bucket.winningLabels.push(resolved);
      }
    }
    bucket.verdicts.push({
      rowIndex: ev.index,
      rawLabel: label,
      reasoning: ev.details ?? null,
    });
  }

  const columns: BatchComparisonColumn[] = [];
  for (const bucket of buckets.values()) {
    // Judge inputs first; then any winner we saw that they didn't cover
    // (a variant the run's target snapshot has since lost). Never drop one.
    const variantIds = [...bucket.candidateIds];
    for (const label of bucket.winningLabels) {
      if (!variantIds.includes(label)) variantIds.push(label);
    }

    // A legacy two-slot run whose inputs carried no candidate ids: the slot
    // letters are all we have, so fall back to target-column order.
    if (variantIds.length === 0 && bucket.sawSlotLabels) {
      variantIds.push(...targetColumns.slice(0, 2).map((t) => t.id));
    }

    const variants: BatchComparisonVariant[] = variantIds.map((id, index) => ({
      id,
      name: targetNameById.get(id) ?? id ?? `Variant ${index + 1}`,
    }));
    // Slot letters must always have two positions to resolve against, even
    // when the run only ever produced one target column.
    while (bucket.sawSlotLabels && variants.length < 2) {
      variants.push({
        id: null,
        name: `Variant ${String.fromCharCode(65 + variants.length)}`,
      });
    }

    const verdictsByRow: Record<number, BatchComparisonVerdict> = {};
    for (const { rowIndex, rawLabel, reasoning } of bucket.verdicts) {
      let winnerId: string | null;
      if (rawLabel === "tie") {
        winnerId = null;
      } else if (rawLabel === "A" || rawLabel === "B") {
        // Legacy slot contract: position in the variant list names the winner.
        winnerId = variants[rawLabel === "A" ? 0 : 1]?.id ?? null;
      } else {
        winnerId = resolveToTargetId(rawLabel) ?? rawLabel;
      }

      // Look up the winning variant's actual output text so the row cell can
      // show "what was right" alongside "why". Ties get no winner output —
      // there was no definitively-right answer to surface.
      const winnerCell = winnerId
        ? rows[rowIndex]?.targets[winnerId]
        : undefined;

      verdictsByRow[rowIndex] = {
        rowIndex,
        winnerId,
        reasoning,
        winnerOutput: winnerCell
          ? extractWinnerOutputText(winnerCell.output)
          : null,
      };
    }

    columns.push({
      evaluatorId: bucket.evaluatorId,
      name: bucket.name,
      variants,
      verdictsByRow,
    });
  }
  return columns;
};

/**
 * Detect output fields for a specific target from the dataset
 */
const detectOutputFields = (
  dataset: ExperimentRunWithItems["dataset"],
  targetId: string,
): string[] => {
  const fields = new Set<string>();
  for (const entry of dataset) {
    if (entry.targetId === targetId && entry.predicted) {
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
  evaluations: ExperimentRunWithItems["evaluations"],
  evaluatorId: string,
): string[] => {
  const fields = new Set<string>();
  for (const evaluation of evaluations) {
    const inputs = evaluation.inputs;
    if (evaluation.evaluator === evaluatorId && inputs) {
      // Add all input fields - we'll display the full data
      for (const key of Object.keys(inputs)) {
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
  evaluations: ExperimentRunWithItems["evaluations"],
  evaluatorId: string,
): Record<string, unknown> | null => {
  for (const evaluation of evaluations) {
    if (evaluation.evaluator !== evaluatorId) continue;
    const inputs = evaluation.inputs;
    if (!inputs) continue;
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
  dataset: ExperimentRunWithItems["dataset"],
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
  dataset: ExperimentRunWithItems["dataset"],
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
