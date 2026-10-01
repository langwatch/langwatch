/**
 * Types for Batch Evaluation Results visualization
 */

import {
  resolveExperimentVerdictLabel,
  type ExperimentRunWithItems,
} from "@langwatch/experiment-contract";
import { z } from "zod";

import { disambiguateNames } from "./batch-results/presentation.tsx";

const jsonRecordSchema = z.record(z.string(), z.unknown());
const comparisonCandidateSchema = z.object({ id: z.string().optional() }).passthrough();

const jsonRecordOf = (value: unknown): Record<string, unknown> | null => {
  const parsed = jsonRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  jsonRecordOf(value) !== null;

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
  output: unknown;
  /** Total cost for this target execution */
  cost: number | null;
  /** Duration in milliseconds */
  duration: number | null;
  /**
   * The engine's engineer-facing failure string. NOT customer copy — a cell
   * renders it only when the row carries no `domainError` (rows written before
   * the code was persisted).
   */
  error: string | null;
  /**
   * The failure's stable code. What the customer reads comes from the
   * presentation registry keyed on it, so a reload shows the same words the
   * live run did (ADR-045).
   */
  domainError?: ExperimentRunWithItems["dataset"][number]["domainError"];
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
  /**
   * The name to show the reader. Two targets on one board can carry the identical
   * stored `name`, so this adds the same "(1)" / "(2)" suffix the workbench adds, over
   * the columns this run renders.
   */
  displayName?: string;
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
   * Text of the winning variant's actual output for this row, so the row cell can
   * surface "what was right" alongside "why".
   */
  winnerOutput?: string | null;
  /**
   * Candidate ids the judge actually compared on THIS row (from the judge's own
   * `inputs.candidates`), which can be a strict subset of the column's full `variants`
   * — select_best_compare drops any candidate with no output for that row.
   */
  candidateIds?: string[];
  /**
   * True when `winnerId === null` because the judge's label failed to resolve to any
   * known variant (a stale/unrecognized slot), as opposed to a genuine tie verdict.
   */
  isUnresolved?: boolean;
  /**
   * True when the row produced no verdict at all: the judge's two swap-and-reconcile
   * passes named different winners, it answered with no winner in it, or it declined
   * before calling because the row had fewer than two candidate outputs.
   */
  isUnsettled?: boolean;
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
  /**
   * Rows the judge ran on and declined to call, rather than rows it never saw.
   */
  rowsWithoutVerdict?: number;
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
   * Comparison evaluator columns detected in this run. Empty when no evaluator emitted
   * a tie or winning-variant label. Rendered as an extra "Winner" column per comparison
   * evaluator after target columns.
   */
  comparisonColumns?: BatchComparisonColumn[];
  /** Row data */
  rows: BatchResultRow[];
};

// Transform ExperimentRunWithItems data into row-based format for TanStack Table.
const resolveV2OutputTargetPredicted = (
  predicted: Record<string, unknown>,
  targetId: string,
): unknown => {
  const isNested = Object.values(predicted).some(
    (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  );
  if (isNested && targetId in predicted) {
    return predicted[targetId];
  }
  if (!isNested) {
    return predicted;
  }
  return predicted.end ?? predicted;
};

/**
 * Resolves a row's predicted output for a non-virtual target: V3 predicted
 * is already the target's output; V2 predicted may be nested by node or flat
 * under the "output"/"end"/"" target id.
 */
const resolvePredictedOutputForTarget = ({
  predicted,
  targetId,
  isV3,
}: {
  predicted: Record<string, unknown>;
  targetId: string;
  isV3: boolean;
}): unknown => {
  if (isV3) {
    return predicted;
  }
  if (targetId === "output" || targetId === "end" || targetId === "") {
    // Check if it's flat (V2 old style) or nested
    return resolveV2OutputTargetPredicted(predicted, targetId);
  }
  if (targetId in predicted) {
    return predicted[targetId];
  }
  return null;
};

type RunDatasetEntry = ExperimentRunWithItems["dataset"][number];
type RunEvaluation = ExperimentRunWithItems["evaluations"][number];
type RunTargets = NonNullable<ExperimentRunWithItems["targets"]>;

const EVALUATOR_TARGET_PREFIX = "_eval_";

const datasetColumnsOf = (dataset: RunDatasetEntry[]): BatchDatasetColumn[] => {
  const names = new Set(dataset.flatMap((entry) => Object.keys(entry.entry ?? {})));
  return [...names].map((name) => ({ name, hasImages: detectHasImages(dataset, name) }));
};

/**
 * V3 targets: the ones this run holds data for, else all. A comparison wired as its own
 * column-target hosts a verdict, not an output, so its evaluator id counts as data. Names
 * are numbered across the whole declared board so compare mode's by-id merge stays stable.
 */
const declaredTargetColumnsOf = ({
  targets,
  dataset,
  evaluations,
}: {
  targets: RunTargets;
  dataset: RunDatasetEntry[];
  evaluations: RunEvaluation[];
}): BatchTargetColumn[] => {
  const targetIdsWithData = new Set<string>();
  for (const entry of dataset) if (entry.targetId) targetIdsWithData.add(entry.targetId);
  for (const evaluation of evaluations) {
    if (evaluation.targetId) targetIdsWithData.add(evaluation.targetId);
    targetIdsWithData.add(evaluation.evaluator);
  }
  const withData = targets.filter((target) => targetIdsWithData.has(target.id));
  const runTargets = withData.length > 0 ? withData : targets;
  const boardNames = disambiguateNames(targets.map((t) => t.name));
  const displayNameById = new Map(
    targets.map((target, index) => [target.id, boardNames[index] ?? target.name]),
  );
  return runTargets.map((target) => ({
    id: target.id,
    name: target.name,
    displayName: displayNameById.get(target.id) ?? target.name,
    type: target.type === "custom" ? "custom" : (target.type as BatchTargetColumn["type"]),
    promptId: target.promptId,
    promptVersion: target.promptVersion,
    agentId: target.agentId,
    evaluatorId: target.evaluatorId,
    model: target.model,
    metadata: target.metadata,
    outputFields: detectOutputFields(dataset, target.id),
  }));
};

/** API evaluations with no targets and no predictions: one virtual target per evaluator. */
const evaluatorTargetColumnsOf = (evaluations: RunEvaluation[]): BatchTargetColumn[] => {
  const uniqueEvaluators = new Map<string, string>();
  for (const evaluation of evaluations) {
    if (!uniqueEvaluators.has(evaluation.evaluator)) {
      uniqueEvaluators.set(evaluation.evaluator, evaluation.name ?? evaluation.evaluator);
    }
  }
  return [...uniqueEvaluators.entries()].map(([evaluatorId, evaluatorName]) => ({
    id: `${EVALUATOR_TARGET_PREFIX}${evaluatorId}`,
    name: evaluatorName,
    type: "legacy" as const,
    outputFields: detectEvaluatorOutputFieldsForEvaluator(evaluations, evaluatorId),
  }));
};

/**
 * Target columns without declared targets: V2 predicted columns (flat or nested), else one
 * virtual target per evaluator, else a lone "Output" so SDK row errors stay visible.
 */
const inferredTargetColumnsOf = ({
  dataset,
  evaluations,
}: {
  dataset: RunDatasetEntry[];
  evaluations: RunEvaluation[];
}): BatchTargetColumn[] => {
  const predictedColumns = detectPredictedColumns(dataset);
  if (Object.keys(predictedColumns).length > 0) {
    return Object.entries(predictedColumns).map(([node, fields]) => ({
      id: node || "output",
      name: node === "end" || node === "" ? "Output" : node,
      type: "legacy" as const,
      outputFields: Array.from(fields),
    }));
  }
  if (evaluations.length > 0) return evaluatorTargetColumnsOf(evaluations);
  if (dataset.some((entry) => entry.error && !entry.targetId)) {
    return [{ id: "_default", name: "Output", type: "custom" as const, outputFields: [] }];
  }
  return [];
};

const evaluatorNamesOf = (evaluations: RunEvaluation[]): Map<string, string> => {
  const names = new Map<string, string>();
  for (const evaluation of evaluations) {
    const key = evaluation.targetId
      ? `${evaluation.targetId}:${evaluation.evaluator}`
      : evaluation.evaluator;
    if (!names.has(key)) names.set(key, evaluation.name ?? evaluation.evaluator);
  }
  return names;
};

/** The run's entries and evaluations indexed by row, and by `row:target`. */
type RunIndex = {
  isV3: boolean;
  entryByRow: Map<number, RunDatasetEntry>;
  entryByRowTarget: Map<string, RunDatasetEntry>;
  evaluationsByRowTarget: Map<string, RunEvaluation[]>;
};

/** A V3 row can hold one entry per target; the row's base entry is its target-less one. */
const runIndexOf = ({
  dataset,
  evaluations,
  isV3,
}: {
  dataset: RunDatasetEntry[];
  evaluations: RunEvaluation[];
  isV3: boolean;
}): RunIndex => {
  const entryByRow = new Map<number, RunDatasetEntry>();
  const entryByRowTarget = new Map<string, RunDatasetEntry>();
  for (const entry of dataset) {
    if (!entryByRow.has(entry.index) || !entry.targetId) entryByRow.set(entry.index, entry);
    entryByRowTarget.set(`${entry.index}:${entry.targetId ?? ""}`, entry);
  }
  const evaluationsByRowTarget = new Map<string, RunEvaluation[]>();
  for (const evaluation of evaluations) {
    const key = `${evaluation.index}:${evaluation.targetId ?? ""}`;
    evaluationsByRowTarget.set(key, [...(evaluationsByRowTarget.get(key) ?? []), evaluation]);
  }
  return { isV3, entryByRow, entryByRowTarget, evaluationsByRowTarget };
};

const evaluatorResultOf = (ev: RunEvaluation): BatchEvaluatorResult => ({
  evaluatorId: ev.evaluator,
  evaluatorName: ev.name ?? ev.evaluator,
  status: ev.status,
  score: ev.score,
  passed: ev.passed,
  label: ev.label,
  details: ev.details,
  cost: ev.cost,
  duration: ev.duration,
  inputs: ev.inputs ?? void 0,
});

/** A virtual evaluator target's cell: that evaluator's inputs are the output. */
const evaluatorTargetOutputOf = ({
  index,
  row,
  evaluatorId,
}: {
  index: RunIndex;
  row: number;
  evaluatorId: string;
}): { output: unknown; evaluations: RunEvaluation[] } => {
  const rowEvaluations = index.evaluationsByRowTarget.get(`${row}:`) ?? [];
  return {
    output: extractOutputFromEvaluatorInputsForEvaluator(rowEvaluations, evaluatorId),
    evaluations: rowEvaluations.filter((ev) => ev.evaluator === evaluatorId),
  };
};

/** One target's cell in one row; V2 rows fall back to the row's untargeted evaluations. */
const targetOutputOf = ({
  index,
  row,
  targetId,
}: {
  index: RunIndex;
  row: number;
  targetId: string;
}): BatchTargetOutput => {
  const baseEntry = index.entryByRow.get(row);
  const targetEntry = index.isV3
    ? (index.entryByRowTarget.get(`${row}:${targetId}`) ?? baseEntry)
    : baseEntry;
  const untargeted = index.isV3 ? [] : (index.evaluationsByRowTarget.get(`${row}:`) ?? []);
  const { output, evaluations } = targetId.startsWith(EVALUATOR_TARGET_PREFIX)
    ? evaluatorTargetOutputOf({
        index,
        row,
        evaluatorId: targetId.slice(EVALUATOR_TARGET_PREFIX.length),
      })
    : {
        output: targetEntry?.predicted
          ? resolvePredictedOutputForTarget({
              predicted: targetEntry.predicted,
              targetId,
              isV3: index.isV3,
            })
          : null,
        evaluations: index.evaluationsByRowTarget.get(`${row}:${targetId}`) ?? untargeted,
      };
  return {
    targetId,
    output,
    cost: targetEntry?.cost ?? null,
    duration: targetEntry?.duration ?? null,
    error: targetEntry?.error ?? null,
    domainError: targetEntry?.domainError,
    traceId: targetEntry?.traceId ?? null,
    evaluatorResults: evaluations.map(evaluatorResultOf),
  };
};

export const transformBatchEvaluationData = (data: ExperimentRunWithItems): BatchEvaluationData => {
  const { experimentId, runId, dataset, evaluations, targets, timestamps, progress, total } = data;
  const isV3 = !!targets && targets.length > 0;
  const targetColumns = isV3
    ? declaredTargetColumnsOf({ targets, dataset, evaluations })
    : inferredTargetColumnsOf({ dataset, evaluations });
  const evaluatorNames = evaluatorNamesOf(evaluations);
  const index = runIndexOf({ dataset, evaluations, isV3 });
  const rowCount = dataset.length > 0 ? Math.max(...dataset.map((d) => d.index)) + 1 : 0;

  const rows: BatchResultRow[] = Array.from({ length: rowCount }, (_, row) => ({
    index: row,
    datasetEntry: index.entryByRow.get(row)?.entry ?? {},
    targets: Object.fromEntries(
      targetColumns.map((column) => [
        column.id,
        targetOutputOf({ index, row, targetId: column.id }),
      ]),
    ),
  }));

  return {
    runId,
    experimentId,
    projectId: data.projectId,
    createdAt: timestamps.createdAt,
    finishedAt: timestamps.finishedAt,
    stoppedAt: timestamps.stoppedAt,
    progress,
    total,
    datasetColumns: datasetColumnsOf(dataset),
    targetColumns,
    evaluatorIds: Array.from(evaluatorNames.keys()),
    evaluatorNames: Object.fromEntries(evaluatorNames),
    comparisonColumns: detectComparisonColumns(evaluations, targetColumns, rows),
    rows,
  };
};

/**
 * Peel the winning target's stored output to a display string. Handles the three shapes
 * we see in the wild: 1. A plain string (single-output-field target unwrapped at
 * storage). 2. `{ output: "..." }` — the conventional flat-key shape. 3.
 */
export const extractOutputText = (raw: unknown): string | null => {
  if (raw === null || raw === void 0) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw !== "object") return JSON.stringify(raw);
  // Up to 3 layers of `.output` / `.answer` unwrap covers structured outputs
  // stored as `{output: {output: "..."}}` without recursing forever on
  // pathological shapes.
  let cursor: unknown = raw;
  for (let i = 0; i < 3; i++) {
    const record = jsonRecordOf(cursor);
    if (!record) break;

    const candidate = record.output ?? record.answer;
    if (typeof candidate === "string") return candidate;
    if (candidate === void 0 || candidate === null) break;
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
      .map((candidate) => {
        const parsed = comparisonCandidateSchema.safeParse(candidate);
        return parsed.success ? parsed.data.id : void 0;
      })
      .filter((id): id is string => typeof id === "string");
  }
  // Legacy two-slot contract, still present on runs stored before the merge.
  return [inputs.candidate_a_id, inputs.candidate_b_id].filter(
    (id): id is string => typeof id === "string",
  );
};

/** Every way a verdict label can name a target: its id, display name or prompt handle. */
type TargetLookup = {
  nameById: Map<string, string>;
  idByAnyKey: Map<string, string>;
  /** Target columns of type "evaluator" are comparison columns whatever they report. */
  forcedComparisonIds: Set<string>;
};

/**
 * Langevals echoes back the variant's display identifier as the verdict label (for prompt
 * targets the prompt handle, e.g. "say-hi", not the `target_XYZ` id), so resolve any of them.
 */
const targetLookupOf = (targetColumns: BatchTargetColumn[]): TargetLookup => {
  const idByAnyKey = new Map<string, string>();
  for (const t of targetColumns) {
    for (const key of [t.id, t.name, t.promptId]) if (key) idByAnyKey.set(key, t.id);
  }
  return {
    nameById: new Map(targetColumns.map((t) => [t.id, t.name])),
    idByAnyKey,
    forcedComparisonIds: new Set(
      targetColumns.filter((t) => t.type === "evaluator").map((t) => t.id),
    ),
  };
};

const isSlotLabel = (v: string): v is "A" | "B" | "tie" => v === "A" || v === "B" || v === "tie";

/** "tie" is valid under both the two-slot and the N-way contract; only "A"/"B" are legacy. */
const isLegacySlotLabel = (v: string): v is "A" | "B" => v === "A" || v === "B";

/** An evaluator whose type or display name reads as a comparison judge. */
const looksLikeComparisonJudge = (ev: RunEvaluation) =>
  [ev.evaluator ?? "", ev.name ?? ""]
    .map((f) => f.toLowerCase())
    .some(
      (field) =>
        field.includes("pairwise") || field.includes("select_best") || field.includes("comparison"),
    );

/** Separate comparison instances: the same evaluator type wired against different variant sets. */
const comparisonKeyOf = (ev: RunEvaluation) =>
  ev.name ? `${ev.evaluator}::${ev.name}` : ev.evaluator;

type ComparisonReading = "skipped" | "labelled" | "unlabelled";

/** How one evaluation reads as a comparison verdict, or null when it is not one. */
const comparisonReadingOf = (ev: RunEvaluation, lookup: TargetLookup): ComparisonReading | null => {
  const isComparison = looksLikeComparisonJudge(ev) || lookup.forcedComparisonIds.has(ev.evaluator);
  if (ev.status === "skipped" && isComparison) return "skipped";
  if (ev.status !== "processed") return null;
  const label = ev.label ?? "";
  if (label.length === 0) return isComparison ? "unlabelled" : null;
  const isRelated = isSlotLabel(label) || lookup.idByAnyKey.has(label);
  return isRelated || isComparison ? "labelled" : null;
};

type BucketVerdict = {
  rowIndex: number;
  rawLabel: string;
  reasoning: string | null;
  candidateIds: string[];
  /** No verdict for the row; carried straight through to the verdict's own `isUnsettled`. */
  isUnsettled?: boolean;
};

type ComparisonBucket = {
  key: string;
  evaluatorId: string;
  name: string;
  /** First-seen judge order of the candidates, from the judge's inputs. */
  candidateIds: string[];
  /** Non-tie labels observed as winners, in first-seen order. */
  winningLabels: string[];
  sawSlotLabels: boolean;
  verdicts: BucketVerdict[];
};

/**
 * The bucket for an evaluation's comparison, created on first sight. A null name prefers the
 * target column's display name, so a column-target reads "Comparison", not `target_XYZ`.
 */
const bucketFor = (
  buckets: Map<string, ComparisonBucket>,
  ev: RunEvaluation,
  lookup: TargetLookup,
): ComparisonBucket => {
  const key = comparisonKeyOf(ev);
  const existing = buckets.get(key);
  if (existing) return existing;
  const bucket: ComparisonBucket = {
    key,
    evaluatorId: ev.evaluator,
    name: ev.name ?? lookup.nameById.get(ev.evaluator) ?? ev.evaluator,
    candidateIds: [],
    winningLabels: [],
    sawSlotLabels: false,
    verdicts: [],
  };
  buckets.set(key, bucket);
  return bucket;
};

const pushUnique = (list: string[], value: string) => {
  if (!list.includes(value)) list.push(value);
};

/**
 * Records one evaluation into its bucket. The judge's inputs are authoritative on who it
 * compared: they name every candidate even when only one ever wins.
 */
const recordComparison = ({
  bucket,
  ev,
  reading,
  lookup,
}: {
  bucket: ComparisonBucket;
  ev: RunEvaluation;
  reading: ComparisonReading;
  lookup: TargetLookup;
}) => {
  const candidateIds = readCandidateIds(ev.inputs ?? {}).map(
    (id) => lookup.idByAnyKey.get(id) ?? id,
  );
  for (const id of candidateIds) pushUnique(bucket.candidateIds, id);
  const reasoning = ev.details ?? null;
  const rowIndex = ev.index;

  // Skipped: the row had too few outputs to judge, or the answer could not be used.
  if (reading === "skipped") {
    bucket.verdicts.push({ rowIndex, rawLabel: "", reasoning, candidateIds, isUnsettled: true });
    return;
  }
  if (reading === "unlabelled") return;

  const label = ev.label ?? "";
  if (isLegacySlotLabel(label)) bucket.sawSlotLabels = true;
  else if (!isSlotLabel(label)) {
    pushUnique(bucket.winningLabels, lookup.idByAnyKey.get(label) ?? label);
  }
  bucket.verdicts.push({ rowIndex, rawLabel: label, reasoning, candidateIds });
};

/**
 * Judge inputs first, then any winner they did not cover (a variant the run's target
 * snapshot has since lost). A legacy two-slot run with no candidate ids falls back to
 * target-column order, and slot letters always get two positions to resolve against.
 */
const comparisonVariantsOf = ({
  bucket,
  lookup,
  targetColumns,
}: {
  bucket: ComparisonBucket;
  lookup: TargetLookup;
  targetColumns: BatchTargetColumn[];
}): BatchComparisonVariant[] => {
  const variantIds = [...bucket.candidateIds];
  for (const label of bucket.winningLabels) pushUnique(variantIds, label);
  if (variantIds.length === 0 && bucket.sawSlotLabels) {
    variantIds.push(...targetColumns.slice(0, 2).map((t) => t.id));
  }
  const variants: BatchComparisonVariant[] = variantIds.map((id, index) => ({
    id,
    name: lookup.nameById.get(id) ?? id ?? `Variant ${index + 1}`,
  }));
  while (bucket.sawSlotLabels && variants.length < 2) {
    variants.push({ id: null, name: `Variant ${String.fromCharCode(65 + variants.length)}` });
  }
  return variants;
};

/**
 * A real tie is 0.5/0.5 evidence for Bradley-Terry aggregation; an unresolved label is no
 * evidence at all. Both leave winnerId null. Resolution reuses resolveVerdictLabel's mapping.
 */
const verdictWinnerOf = ({
  rawLabel,
  variants,
  lookup,
}: {
  rawLabel: string;
  variants: BatchComparisonVariant[];
  lookup: TargetLookup;
}): { winnerId: string | null; isUnresolved: boolean } => {
  if (rawLabel === "tie") return { winnerId: null, isUnresolved: false };
  const resolved = resolveExperimentVerdictLabel({
    label: rawLabel,
    variants: variants.map((v) => v.id ?? ""),
  });
  const isUnresolved = resolved === "" || resolved === "A" || resolved === "B";
  return {
    winnerId: isUnresolved ? null : (lookup.idByAnyKey.get(resolved) ?? resolved),
    isUnresolved,
  };
};

/** A row's verdict, with the winner's output so the cell shows "what was right" beside "why". */
const comparisonVerdictOf = ({
  verdict,
  variants,
  lookup,
  rows,
}: {
  verdict: BucketVerdict;
  variants: BatchComparisonVariant[];
  lookup: TargetLookup;
  rows: BatchResultRow[];
}): BatchComparisonVerdict => {
  const { rowIndex, rawLabel, reasoning, candidateIds } = verdict;
  if (verdict.isUnsettled) {
    return {
      rowIndex,
      winnerId: null,
      reasoning,
      winnerOutput: null,
      candidateIds,
      isUnsettled: true,
    };
  }
  const { winnerId, isUnresolved } = verdictWinnerOf({ rawLabel, variants, lookup });
  const winnerCell = winnerId ? rows[rowIndex]?.targets[winnerId] : void 0;
  return {
    rowIndex,
    winnerId,
    reasoning,
    winnerOutput: winnerCell ? extractOutputText(winnerCell.output) : null,
    candidateIds,
    isUnresolved,
  };
};

/**
 * Detect comparison evaluators by observing their per-row label shapes. Declined comparisons
 * are counted apart from the buckets: a run where every row was declined has no bucket.
 */
const detectComparisonColumns = (
  evaluations: ExperimentRunWithItems["evaluations"],
  targetColumns: BatchTargetColumn[],
  rows: BatchResultRow[],
): BatchComparisonColumn[] => {
  const lookup = targetLookupOf(targetColumns);
  const skippedByKey = new Map<string, number>();
  const buckets = new Map<string, ComparisonBucket>();

  for (const ev of evaluations) {
    const reading = comparisonReadingOf(ev, lookup);
    if (!reading) continue;
    if (reading === "skipped") {
      const key = comparisonKeyOf(ev);
      skippedByKey.set(key, (skippedByKey.get(key) ?? 0) + 1);
    }
    recordComparison({ bucket: bucketFor(buckets, ev, lookup), ev, reading, lookup });
  }

  return [...buckets.values()].map((bucket) => {
    const variants = comparisonVariantsOf({ bucket, lookup, targetColumns });
    const verdictsByRow: Record<number, BatchComparisonVerdict> = {};
    for (const verdict of bucket.verdicts) {
      verdictsByRow[verdict.rowIndex] = comparisonVerdictOf({ verdict, variants, lookup, rows });
    }
    return {
      evaluatorId: bucket.evaluatorId,
      name: bucket.name,
      variants,
      verdictsByRow,
      rowsWithoutVerdict: skippedByKey.get(bucket.key) ?? 0,
    };
  });
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
const UNWRAPPED_OUTPUT_KEYS = new Set(["output", "response", "generated", "answer", "prediction"]);

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
      if (UNWRAPPED_OUTPUT_KEYS.has(key)) {
        return { output: inputs[key] };
      }
    }

    // Otherwise return all inputs as-is (will be displayed as JSON)
    if (keys.length > 0) {
      return inputs;
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
  const predictions = dataset.flatMap((d) => (d.predicted ? [d.predicted] : []));
  const firstPredicted = predictions[0];
  if (!firstPredicted) return {};

  // Flat format `{ field: value }` sits under "end"; nested `{ node: { field } }` per node.
  if (!Object.values(firstPredicted).every(isJsonRecord)) {
    return { end: new Set(predictions.flatMap((predicted) => Object.keys(predicted))) };
  }

  const columns: Record<string, Set<string>> = {};
  for (const [node, value] of predictions.flatMap((predicted) => Object.entries(predicted))) {
    const nodeOutput = jsonRecordOf(value);
    if (!nodeOutput) continue;
    columns[node] ??= new Set();
    for (const key of Object.keys(nodeOutput)) columns[node].add(key);
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
