/**
 * Orchestrator - Manages evaluation execution across multiple cells.
 *
 * The orchestrator:
 * 1. Iterates cells based on execution scope
 * 2. Builds and executes workflows via langwatch_nlp
 * 3. Maps NLP events to SSE events
 * 4. Handles errors gracefully
 * 5. Supports parallel execution with rate limiting
 * 6. Checks abort flags between executions
 */

import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { studioBackendPostEvent } from "~/app/api/workflows/post_event/post-event";
import type {
  ComparisonEvaluatorConfig,
  EvaluationsV3State,
  EvaluatorConfig,
  FieldMapping,
  TargetConfig,
} from "~/experiments-v3/types";
import {
  COMPARISON_EVALUATOR_TYPE,
  isComparisonEvaluator,
  isGoldenFieldSatisfied,
  LEGACY_PAIRWISE_EVALUATOR_TYPE,
} from "~/experiments-v3/types";
import { isRowEmpty } from "~/experiments-v3/utils/emptyRowDetection";
import { toComparisonConfig } from "~/experiments-v3/utils/normalizeComparison";
import { disambiguateNames } from "~/experiments-v3/utils/variantDisambiguation";
import { addEnvs } from "~/optimization_studio/server/addEnvs";
import { loadDatasets } from "~/optimization_studio/server/loadDatasets";
import type { ExecutionState, Workflow } from "~/optimization_studio/types/dsl";
import type { StudioServerEvent } from "~/optimization_studio/types/events";
import { nodeErrorToDomainError } from "~/optimization_studio/utils/nodeErrorDomain";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { getApp } from "~/server/app-layer/app";
import type { SingleEvaluationResult } from "~/server/evaluations/evaluators";
import type {
  RecordEvaluatorResultCommandData,
  RecordTargetResultCommandData,
} from "~/server/event-sourcing/pipelines/experiment-run-processing/schemas/commands";
import type { ESBatchEvaluationTarget } from "~/server/experiments/types";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import {
  estimateCost,
  getMatchingLLMModelCost,
} from "~/server/tracer/collector/cost";
import { KSUID_RESOURCES } from "~/utils/constants";
import { generateHumanReadableId } from "~/utils/humanReadableId";
import { generateOtelTraceId } from "~/utils/trace";
import { abortManager } from "./abortManager";
import { type LoadedWorkflow, workflowLoadKey } from "./dataLoader";
import { buildStripScoreEvaluatorIds } from "./evaluatorScoreFilter";
import {
  extractTargetOutput,
  mapNlpEvent,
  mapThrownErrorEvent,
  mapWorkflowEvaluatorResult,
  type ResultMapperConfig,
} from "./resultMapper";
import { createSemaphore } from "./semaphore";
import {
  type EvaluationV3Event,
  type ExecutionCell,
  type ExecutionScope,
  type ExecutionSummary,
  UNNAMED_FAILURE,
} from "./types";
import { buildCellWorkflow } from "./workflowBuilder";

const logger = createLogger("experiments-v3:orchestrator");

// Default concurrency limit (can be overridden via environment variable or request)
const DEFAULT_CONCURRENCY = parseInt(
  process.env.EVAL_V3_CONCURRENCY ?? "10",
  10,
);

/**
 * Input data required to run the orchestrator.
 */
export type OrchestratorInput = {
  projectId: string;
  experimentId?: string; // For ES storage
  workflowVersionId?: string; // For ES storage
  scope: ExecutionScope;
  state: EvaluationsV3State;
  datasetRows: Array<Record<string, unknown>>;
  datasetColumns: Array<{ id: string; name: string; type: string }>;
  loadedPrompts: Map<string, VersionedPrompt>;
  loadedAgents: Map<string, TypedAgent>;
  /** Evaluators loaded from DB - settings and names are fetched fresh from here */
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  /** Studio workflows loaded for workflow targets (committed DSL run per row) */
  loadedWorkflows?: Map<string, LoadedWorkflow>;
  /** Optional run ID - if not provided, a human-readable ID will be generated */
  runId?: string;
  /** Concurrency limit for parallel execution (default 10) */
  concurrency?: number;
  /**
   * Pre-existing target outputs keyed by `${rowIndex}:${targetId}`. Phase 2
   * pairwise reads from these when the user re-runs only the pairwise
   * column on top of variants that already produced output in a prior run.
   */
  seedTargetOutputs?: Record<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
};

/**
 * The dataset rows a run is actually allowed to touch, given its scope.
 *
 * Every phase must agree on this. Phase 2 (comparison) used to loop over EVERY
 * dataset row regardless of scope, so running one row's comparison emitted a
 * "waiting on …" skip for all the OTHER rows — overwriting their existing
 * verdicts with an error the user never asked for (bugbash 2026-07-14).
 *
 * `full`/`target`/`evaluator-all-rows` span the dataset; the rest are pinned to
 * the rows the user picked.
 */
export const resolveScopedRowIndices = ({
  scope,
  rowCount,
}: {
  scope: ExecutionScope;
  rowCount: number;
}): number[] => {
  const allRows = () => Array.from({ length: rowCount }, (_, i) => i);
  const inRange = (i: number) => i >= 0 && i < rowCount;

  switch (scope.type) {
    case "full":
    case "target":
    case "evaluator-all-rows":
      return allRows();
    case "rows":
      return scope.rowIndices.filter(inRange);
    case "cell":
    case "evaluator":
      return [scope.rowIndex].filter(inRange);
    default:
      return [];
  }
};

type GenerateCellsState = Pick<
  EvaluationsV3State,
  "datasets" | "activeDatasetId" | "targets" | "evaluators"
>;

type GenerateCellsOptions = {
  seedTargetOutputs?: Record<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
};

/**
 * Handles the evaluator-all-rows scope: run one evaluator across all rows
 * that already have a precomputed target output.
 */
const buildEvaluatorAllRowsCells = ({
  scope,
  state,
  datasetRows,
  datasetId,
}: {
  scope: Extract<ExecutionScope, { type: "evaluator-all-rows" }>;
  state: GenerateCellsState;
  datasetRows: Array<Record<string, unknown>>;
  datasetId: string;
}): ExecutionCell[] => {
  const cells: ExecutionCell[] = [];
  const targetConfig = state.targets.find(
    (t: TargetConfig) => t.id === scope.targetId,
  );
  const evaluatorConfig = state.evaluators.find(
    (e) => e.id === scope.evaluatorId,
  );

  // A comparison evaluator needs every variant's output, not one target's
  // — the same reason Phase 1 skips it (see the comparison-skip comment
  // below). Attaching it to a single-target cell here would silently
  // produce an empty input object rather than a real comparison run.
  if (
    !targetConfig ||
    !evaluatorConfig ||
    isComparisonEvaluator(evaluatorConfig)
  )
    return cells;

  for (const [rowIndexStr, targetOutput] of Object.entries(
    scope.precomputedTargetOutputs,
  )) {
    const rowIndex = Number(rowIndexStr);
    const datasetEntry = datasetRows[rowIndex];
    if (!datasetEntry) continue;

    cells.push({
      rowIndex,
      targetId: scope.targetId,
      targetConfig,
      evaluatorConfigs: [evaluatorConfig],
      datasetEntry: {
        _datasetId: datasetId,
        ...datasetEntry,
      },
      skipTarget: true,
      precomputedTargetOutput: targetOutput,
      traceId: scope.traceIds[rowIndex],
    });
  }
  return cells;
};

/**
 * Handles the evaluator scope: a single evaluator re-run with a
 * pre-computed target output.
 */
const buildEvaluatorScopeCells = ({
  scope,
  state,
  datasetRows,
  datasetId,
}: {
  scope: Extract<ExecutionScope, { type: "evaluator" }>;
  state: GenerateCellsState;
  datasetRows: Array<Record<string, unknown>>;
  datasetId: string;
}): ExecutionCell[] => {
  const cells: ExecutionCell[] = [];
  const targetConfig = state.targets.find(
    (t: TargetConfig) => t.id === scope.targetId,
  );
  const evaluatorConfig = state.evaluators.find(
    (e) => e.id === scope.evaluatorId,
  );
  const datasetEntry = datasetRows[scope.rowIndex];

  // See the matching guard in the evaluator-all-rows branch above — a
  // comparison evaluator can't run against one target's precomputed output.
  if (
    targetConfig &&
    evaluatorConfig &&
    !isComparisonEvaluator(evaluatorConfig) &&
    datasetEntry
  ) {
    cells.push({
      rowIndex: scope.rowIndex,
      targetId: scope.targetId,
      targetConfig,
      // Only include the single evaluator
      evaluatorConfigs: [evaluatorConfig],
      datasetEntry: {
        _datasetId: datasetId,
        ...datasetEntry,
      },
      // Skip target execution, use pre-computed output
      skipTarget: scope.targetOutput !== undefined,
      precomputedTargetOutput: scope.targetOutput,
      // Reuse existing trace ID to append evaluator span to the same trace
      traceId: scope.traceId,
    });
  }
  return cells;
};

/**
 * For target-/cell-scoped runs against a comparison column-target, the
 * verdict needs every variant's output to exist before Phase 2 can
 * synthesize the comparison cell. If the user hits Play on the Comparison
 * column without first running the variants, expand the scope to include
 * those variants so Phase 1 produces what Phase 2 needs. Without this, only
 * the comparison target is dispatched, Phase 1 skips it (column-style
 * comparisons are always Phase-2-only), and the run completes with 0 cells —
 * visible to the user as a silent no-op with "No verdict yet" everywhere.
 */
const expandComparisonDeps = ({
  state,
  id,
}: {
  state: GenerateCellsState;
  id: string;
}): string[] => {
  const t = state.targets.find((tg: TargetConfig) => tg.id === id);
  if (t?.type !== "evaluator") return [id];
  const deps = (toComparisonConfig(t)?.variants ?? []).filter(
    (v): v is string => !!v,
  );
  if (deps.length === 0) return [id];
  return Array.from(new Set([...deps, id]));
};

/** Determines which targets to process for the general (non-evaluator) scopes. */
const resolveTargetIdsForScope = ({
  scope,
  state,
}: {
  scope: ExecutionScope;
  state: GenerateCellsState;
}): string[] => {
  switch (scope.type) {
    case "full":
    case "rows":
      return state.targets.map((t: TargetConfig) => t.id);
    case "target":
    case "cell":
      return expandComparisonDeps({ state, id: scope.targetId });
    default:
      return [];
  }
};

/** The scoped target's own comparison variants, when scoped to one target/cell. */
const resolveScopedComparisonDeps = ({
  scope,
  state,
}: {
  scope: ExecutionScope;
  state: GenerateCellsState;
}): Set<string> => {
  if (scope.type !== "target" && scope.type !== "cell") return new Set();

  const scopedTarget = state.targets.find(
    (target) => target.id === scope.targetId,
  );
  if (!scopedTarget) return new Set();

  return new Set(
    (toComparisonConfig(scopedTarget)?.variants ?? []).filter(
      (variant): variant is string => !!variant,
    ),
  );
};

/** Builds a single Phase-1 cell for one (row, target), or undefined when it should be skipped. */
const buildCellForTarget = ({
  state,
  datasetId,
  datasetEntry,
  rowIndex,
  targetId,
  scopedComparisonDeps,
  options,
}: {
  state: GenerateCellsState;
  datasetId: string;
  datasetEntry: Record<string, unknown>;
  rowIndex: number;
  targetId: string;
  scopedComparisonDeps: Set<string>;
  options: GenerateCellsOptions;
}): ExecutionCell | undefined => {
  if (
    scopedComparisonDeps.has(targetId) &&
    options.seedTargetOutputs?.[`${rowIndex}:${targetId}`]
  ) {
    return undefined;
  }

  const targetConfig = state.targets.find(
    (t: TargetConfig) => t.id === targetId,
  );
  if (!targetConfig) return undefined;

  // Skip column-style comparison targets (pairwise #5100, N-way #5101)
  // in Phase 1 — they need every variant's output, which is not yet
  // available in a single per-target cell. Picked up by
  // generateComparisonCells in Phase 2.
  if (
    targetConfig.type === "evaluator" &&
    isComparisonEvaluator(targetConfig)
  ) {
    return undefined;
  }

  return {
    rowIndex,
    targetId,
    targetConfig,
    // Comparison evaluators (pairwise #5100, N-way #5101) run in Phase 2
    // once every variant's output exists — they would crash here because
    // the other candidates' outputs are not available within a single
    // per-target cell. See generateComparisonCells.
    evaluatorConfigs: state.evaluators.filter((e) => !isComparisonEvaluator(e)),
    datasetEntry: {
      _datasetId: datasetId,
      ...datasetEntry,
    },
  };
};

/** Builds one Phase-1 cell per (row, target), skipping empty rows and column-style comparison targets. */
const buildStandardCells = ({
  state,
  datasetRows,
  datasetId,
  rowIndices,
  targetIds,
  scopedComparisonDeps,
  options,
}: {
  state: GenerateCellsState;
  datasetRows: Array<Record<string, unknown>>;
  datasetId: string;
  rowIndices: number[];
  targetIds: string[];
  scopedComparisonDeps: Set<string>;
  options: GenerateCellsOptions;
}): ExecutionCell[] => {
  const cells: ExecutionCell[] = [];

  for (const rowIndex of rowIndices) {
    const datasetEntry = datasetRows[rowIndex];
    if (!datasetEntry) continue;

    // Skip completely empty rows
    if (isRowEmpty(datasetEntry)) {
      logger.debug({ rowIndex }, "Skipping empty row");
      continue;
    }

    for (const targetId of targetIds) {
      const cell = buildCellForTarget({
        state,
        datasetId,
        datasetEntry,
        rowIndex,
        targetId,
        scopedComparisonDeps,
        options,
      });
      if (cell) cells.push(cell);
    }
  }

  return cells;
};

/**
 * Generates all cells to execute based on the scope.
 */
export const generateCells = ({
  state,
  datasetRows,
  scope,
  options = {},
}: {
  state: GenerateCellsState;
  datasetRows: Array<Record<string, unknown>>;
  scope: ExecutionScope;
  options?: GenerateCellsOptions;
}): ExecutionCell[] => {
  const datasetId =
    state.datasets[0]?.id ?? state.activeDatasetId ?? "dataset-1";

  // Handle evaluator-all-rows scope - run one evaluator across all rows with existing target outputs
  if (scope.type === "evaluator-all-rows") {
    return buildEvaluatorAllRowsCells({ scope, state, datasetRows, datasetId });
  }

  // Handle evaluator scope specially - single evaluator re-run with pre-computed target output
  if (scope.type === "evaluator") {
    return buildEvaluatorScopeCells({ scope, state, datasetRows, datasetId });
  }

  // Determine which rows to process. Shared with Phase 2's comparison cells so
  // the two phases can never disagree about what's in scope.
  const rowIndices = resolveScopedRowIndices({
    scope,
    rowCount: datasetRows.length,
  });

  // Determine which targets to process.
  const targetIds = resolveTargetIdsForScope({ scope, state });
  const scopedComparisonDeps = resolveScopedComparisonDeps({ scope, state });

  // Generate cells, skipping empty rows
  return buildStandardCells({
    state,
    datasetRows,
    datasetId,
    rowIndices,
    targetIds,
    scopedComparisonDeps,
    options,
  });
};

/**
 * Phase 2 cell generator for comparison evaluators — the one column-vs-column
 * judge, whether it compares two candidates or ten.
 *
 * Called AFTER Phase 1 (per-target) cells complete. For each comparison and
 * each rowIndex where EVERY configured variant produced an output, emit one
 * synthetic cell whose `comparison` field carries the candidates list.
 * `skipTarget` short-circuits target execution; `buildEvaluatorInputs` reads
 * `cell.comparison` to assemble the candidates + golden inputs.
 *
 * Two carriers reach this generator and are treated identically apart from
 * where the verdict is stored:
 *   - chip evaluators (`evaluator.comparison`), whose verdict is stored under
 *     the first variant's column, and
 *   - column-style comparison targets (`target.comparison`), whose verdict is
 *     stored under the comparison column itself.
 *
 * Rows where a variant produced no output are reported via `skipReasons`
 * (never silently dropped) so the caller can emit a synthetic error event per
 * row — otherwise the comparison column sits at "No verdict yet" with no
 * indication that an upstream variant is the actual problem.
 */
export type ComparisonSkipReason = {
  rowIndex: number;
  /** TargetId under which the verdict would have been stored. */
  targetId: string;
  /** The evaluator (or column-target) id whose cell would have run. */
  evaluatorId: string;
  /**
   * Why the row was skipped:
   *  - "missing-output": a variant hasn't produced output yet — re-running the
   *    upstream target fixes it.
   *  - "empty-output": a variant ran but its comparison text came out empty —
   *    the picked output field is gone (renamed schema) or the output was
   *    empty/unserializable. Re-running the target will NOT help; the config or
   *    the output is the problem.
   */
  kind: "missing-output" | "empty-output";
  /** Display-friendly identifiers of the variants that triggered the skip. */
  variantNames: string[];
};

/**
 * "a", "a and b", "a, b and c" — for the skip-reason message, which used to be
 * able to assume exactly two variants.
 */
export const formatList = (names: string[]): string => {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

type ComparisonScoreSample = {
  name: string;
  score?: number;
  label?: string;
  passed?: boolean;
};

/**
 * Structured-output narrowing: when the comparison config carries an output
 * path for this variant, dig into the candidate's output and return just
 * that field. Otherwise the judge sees the whole JSON blob instead of the
 * single text the user actually wants compared. An empty or missing path is
 * a no-op, so single-field configs keep working.
 */
const pickOutputPath = (output: unknown, path?: string[]): unknown => {
  if (!path || path.length === 0) return output;
  let cursor: unknown = output;
  for (const segment of path) {
    if (
      cursor === null ||
      typeof cursor !== "object" ||
      Array.isArray(cursor)
    ) {
      // LangWatch's runtime unwraps a single-output-field target's dict
      // back to a scalar at storage time, so a target declared with one
      // `output` field ends up stored as the plain string value. The
      // mappings picker still records the path as `["output"]` in that
      // case (it's the only field to point at), so a strict object-only
      // walk here would surface as "Variant outputs missing" for every
      // single-field prompt / agent. Return the scalar itself when the
      // remaining path is exactly one segment — this matches the runtime
      // unwrap and keeps single-field targets usable in a comparison.
      return path.length === 1 && path[0] === segment ? cursor : undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
};

const formatComparisonScoreLine = (s: ComparisonScoreSample): string | null => {
  const parts: string[] = [];
  if (s.score !== undefined) parts.push(`score=${s.score}`);
  if (s.label !== undefined) parts.push(`label=${s.label}`);
  if (s.passed !== undefined) parts.push(`passed=${s.passed}`);
  if (parts.length === 0) return null;
  return `- ${s.name}: ${parts.join(", ")}`;
};

/**
 * A variant's existing evaluator scores, rendered as a block to append to its
 * candidate text so the judge can factor them into the verdict. Empty when
 * there are no scores, or when none of them carry a value.
 *
 * This appends to text the caller has already produced, rather than
 * serializing the output a second time itself — `toCandidateText` is the one
 * place that turns an output into judge-readable text, structured or not.
 */
const evaluatorScoresBlock = ({
  rowIndex,
  variantId,
  completedTargetEvaluatorScores,
}: {
  rowIndex: number;
  variantId: string;
  completedTargetEvaluatorScores?: Map<string, ComparisonScoreSample[]>;
}): string => {
  const scores = completedTargetEvaluatorScores?.get(
    `${rowIndex}:${variantId}`,
  );
  if (!scores?.length) return "";
  const lines = scores
    .map(formatComparisonScoreLine)
    .filter((l): l is string => l !== null);
  if (lines.length === 0) return "";
  return `\n\n--- Existing evaluator scores ---\n${lines.join("\n")}`;
};

/**
 * Coerce a candidate's output to the string the judge reads.
 *
 * langevals types `CandidateInput.output` as `str` and pydantic will not
 * coerce a dict, a list, or a number — the whole evaluation 422s. A target
 * emitting a structured output therefore has to arrive here already
 * flattened. `variantOutputPaths` is the precise way to do that (pick the
 * `.answer` field), but a user who never opened the field picker still has
 * an object in hand, and failing their run is the worse answer: the judge
 * can reason about JSON perfectly well.
 *
 * `null` / `undefined` become the empty string, which the judge skips as an
 * empty candidate rather than judging the text "null".
 */
const toCandidateText = (output: unknown): string => {
  if (typeof output === "string") return output;
  if (output === null || output === undefined) return "";
  try {
    return JSON.stringify(output) ?? "";
  } catch {
    // Circular refs / BigInt. Nothing useful to send; treat as empty so the
    // row is skipped with "fewer than 2 candidates" instead of 422ing.
    return "";
  }
};

// Pick the most human-readable identifier we can derive from a TargetConfig.
// langevals echoes each `candidate.id` back to us as the verdict `label`,
// and that label is what every programmatic consumer (REST, SDK, MCP) reads
// first — so prefer the prompt's HANDLE ("say-hi") when we can resolve it;
// otherwise fall back to the internal target id ("target_..."). We
// deliberately do NOT fall back to `promptId` (the KSUID like
// "prompt_6IFkbb..."): the aggregator's normalizer matches against (a)
// legacy A/B/tie, (b) target.id, or (c) the supplied handle — a raw promptId
// KSUID wouldn't normalize and the verdict would be dropped.
const variantIdentifierFor = ({
  target,
  loadedPrompts,
}: {
  target: TargetConfig;
  loadedPrompts?: Map<string, VersionedPrompt>;
}): string => {
  if (target.type === "prompt" && target.promptId) {
    const handle = loadedPrompts?.get(target.promptId)?.handle;
    if (handle) return handle;
  }
  return target.id;
};

/**
 * Collision-safe candidate identifiers for a comparison's resolved variants.
 *
 * variantIdentifierFor prefers a prompt's HANDLE, which the judge echoes back
 * as the winning label. But two variants can point at the SAME prompt (the
 * "reuse the same prompt as two variants" case #5101 adds a spec for —
 * comparing v1 vs v2, or one prompt with different model overrides) and so
 * resolve to the SAME handle. The judge still picks a slot correctly, but it
 * returns a label shared by two candidates, so every downstream consumer
 * (scoreboard, win-rate chart, per-row winner) credits BOTH variants for the
 * win and can never name the second as the sole winner.
 *
 * When a handle is shared by 2+ variants, fall back to the internal target id
 * (always unique) for exactly the colliding entries. labelNamesVariant and
 * detectComparisonColumns both accept target.id as a label, so it round-trips;
 * the handle is still shown as the display name via useTargetName.
 */
const buildVariantIdentifiers = ({
  resolvedVariants,
  loadedPrompts,
}: {
  resolvedVariants: TargetConfig[];
  loadedPrompts?: Map<string, VersionedPrompt>;
}): string[] => {
  const raw = resolvedVariants.map((target) =>
    variantIdentifierFor({ target, loadedPrompts }),
  );
  const counts = new Map<string, number>();
  for (const id of raw) counts.set(id, (counts.get(id) ?? 0) + 1);
  return raw.map((id, i) =>
    (counts.get(id) ?? 0) > 1 ? resolvedVariants[i]!.id : id,
  );
};

/**
 * A variant's human-readable display name — the same label the workbench
 * column header and the comparison config cards show (prompt handle, then
 * name; evaluator name), NOT the collision-safe identifier the judge slots
 * are keyed on. buildVariantIdentifiers falls back to the raw target id for
 * same-handle variants, which is correct for the judge but leaks
 * `target_17841…`-style ids into any user-facing copy that reuses it (e.g. the
 * "Waiting on …" skip message). Mirrors the frontend's pickTargetName so the
 * two never drift.
 */
const variantDisplayNameFor = ({
  target,
  loadedPrompts,
  loadedEvaluators,
}: {
  target: TargetConfig;
  loadedPrompts?: Map<string, VersionedPrompt>;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
}): string => {
  if (target.type === "prompt") {
    if (!target.promptId) return "New Prompt";
    const loaded = loadedPrompts?.get(target.promptId);
    return loaded?.handle ?? loaded?.name ?? "New Prompt";
  }
  if (target.type === "evaluator" && target.targetEvaluatorId) {
    return loadedEvaluators?.get(target.targetEvaluatorId)?.name ?? target.id;
  }
  // Agents/workflows: no loaded entity map is threaded into this function, so
  // fall back to the collision-safe identifier — same as before this helper.
  return variantIdentifierFor({ target, loadedPrompts });
};

/**
 * Display names for a comparison's variants, with the same "(1)/(2)" suffixing
 * the config UI applies to same-name variants — so "support-detailed" run
 * twice reads as "support-detailed (1)" / "(2)" in the skip message, matching
 * the variant cards, instead of two identical names or two raw ids.
 */
const buildVariantDisplayNames = ({
  resolvedVariants,
  loadedPrompts,
  loadedEvaluators,
}: {
  resolvedVariants: TargetConfig[];
  loadedPrompts?: Map<string, VersionedPrompt>;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
}): string[] =>
  disambiguateNames(
    resolvedVariants.map((target) =>
      variantDisplayNameFor({ target, loadedPrompts, loadedEvaluators }),
    ),
  );

/**
 * Resolve configured variant ids to their TargetConfigs, or null if
 * unusable. Applies the same "is this comparison usable" gate to every
 * comparison carrier — chip-style (evaluator.comparison) and column-style
 * (target.comparison) alike — so a comparison missing its golden field
 * (see isGoldenFieldSatisfied, #5378) is skipped consistently rather than
 * running with an empty `golden` while its settings claim golden-aware.
 */
const resolveComparisonVariants = ({
  cfg,
  ownerId,
  state,
}: {
  cfg: ComparisonEvaluatorConfig;
  ownerId: string;
  state: GenerateCellsState;
}): TargetConfig[] | null => {
  if (!cfg.variants || cfg.variants.length < 2) {
    logger.warn(
      { ownerId, variants: cfg.variants },
      "Comparison skipped: fewer than 2 variants configured",
    );
    return null;
  }
  if (!isGoldenFieldSatisfied(cfg)) {
    logger.debug(
      {
        ownerId,
        variants: cfg.variants,
        hasGoldenAnswer: cfg.hasGoldenAnswer,
        goldenField: cfg.goldenField,
      },
      "Comparison skipped: golden field not configured",
    );
    return null;
  }
  const resolved = cfg.variants.map((id) =>
    state.targets.find((t) => t.id === id),
  );
  if (resolved.some((t) => !t)) {
    logger.warn(
      { ownerId, variants: cfg.variants },
      "Comparison skipped: one or more variant targets not found",
    );
    return null;
  }
  return resolved as TargetConfig[];
};

/**
 * Whether a column-target's BACKING DB evaluator is still the legacy
 * two-slot `langevals/pairwise_compare` judge, as opposed to the current
 * N-way `langevals/select_best_compare` one.
 *
 * Column-target cells build a synthetic in-memory EvaluatorConfig (below)
 * rather than reading one out of `state.targets`/`state.evaluators`, so
 * unlike a chip-style comparison (whose `evaluator.evaluatorType` is
 * whatever was actually persisted) the synthetic's type has to be resolved
 * explicitly. Getting this wrong matters: workflowBuilder's
 * `buildEvaluatorNode` always dispatches column-targets via
 * `evaluators/{dbEvaluatorId}`, and that route resolves the judge that
 * actually runs from the DB row's OWN persisted `config.evaluatorType`
 * (see evaluations-legacy.ts), ignoring whatever type we hand it here. An
 * experiment saved before the pairwise/N-way merge still has a DB row
 * whose evaluatorType is the legacy judge — nothing in this PR migrates
 * existing rows — so the payload shape built for this cell must match
 * that row's real type, not the type the workbench would create today.
 *
 * Returns false (current-shape) when there's nothing to resolve against
 * (no `loadedEvaluators`, or the id isn't in it) — the safe default that
 * matches this function's pre-existing behavior.
 */
const isLegacyPairwiseBacked = ({
  dbEvaluatorId,
  loadedEvaluators,
}: {
  dbEvaluatorId: string | undefined;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
}): boolean => {
  if (!dbEvaluatorId) return false;
  const dbConfig = loadedEvaluators?.get(dbEvaluatorId)?.config as
    | { evaluatorType?: string }
    | undefined;
  return dbConfig?.evaluatorType === LEGACY_PAIRWISE_EVALUATOR_TYPE;
};

type ComparisonCandidatesResult =
  | {
      candidates: ExecutionCell["comparison"];
      missing?: never;
      empty?: never;
    }
  | { candidates?: never; missing: string[]; empty?: never }
  | { candidates?: never; missing?: never; empty: string[] };

/**
 * The candidate payload for one row, or the names of the variants that had
 * no output. Applies structured-output narrowing and score augmentation in
 * the config's variant order — that order is what the judge's deterministic
 * shuffle is seeded against.
 */
const buildComparisonCandidates = ({
  cfg,
  variantIds,
  variantDisplayNames,
  rowIndex,
  completedTargetOutputs,
  completedTargetEvaluatorScores,
}: {
  cfg: ComparisonEvaluatorConfig;
  variantIds: string[];
  variantDisplayNames: string[];
  rowIndex: number;
  completedTargetOutputs: Map<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
  completedTargetEvaluatorScores?: Map<string, ComparisonScoreSample[]>;
}): ComparisonCandidatesResult => {
  const outputs = cfg.variants.map((id) =>
    completedTargetOutputs.get(`${rowIndex}:${id}`),
  );

  // Report the friendly display name (not the judge's collision-safe id) for
  // any variant we're waiting on — this list is only ever shown to the user.
  const missing = variantDisplayNames.filter((_, i) => !outputs[i]);
  if (missing.length > 0) return { missing };

  const candidates = cfg.variants.map((variantId, i) => {
    // Narrow to the chosen field first, serialize it, then append the
    // scores. Appending the score block only when there IS text keeps an
    // empty candidate empty: appending regardless produced a candidate that
    // was nothing but scores, which langevals won't drop, so the judge scored
    // a variant that had said nothing against ones that had.
    const text = toCandidateText(
      pickOutputPath(outputs[i]!.output, cfg.variantOutputPaths?.[variantId]),
    );
    return {
      // Collision-safe id (handle, or target.id when a handle is shared) so
      // the winning label always names exactly one variant — see
      // buildVariantIdentifiers.
      id: variantIds[i]!,
      output: text
        ? text +
          evaluatorScoresBlock({
            rowIndex,
            variantId,
            completedTargetEvaluatorScores,
          })
        : text,
      cost: outputs[i]!.cost,
      duration: outputs[i]!.duration,
    };
  });

  // A candidate whose text is empty — the picked field is gone, or the output
  // was empty/unserializable — can't be judged. langevals would drop it and
  // skip the row silently; surface it as a skip reason instead, so a renamed
  // output field doesn't turn into a verdict computed from one fewer
  // candidate (or a bare "no verdict" for a two-way).
  const empty = variantDisplayNames.filter(
    (_, i) => candidates[i]!.output === "",
  );
  if (empty.length > 0) return { empty };

  return { candidates: { candidates } };
};

/**
 * Chip-style comparison evaluators. The verdict is anchored on the first
 * variant's column, which is where the table's comparison column reads it.
 */
const buildChipComparisonRow = ({
  rowIndex,
  datasetEntry,
  cfg,
  anchorVariant,
  evaluator,
  variantIds,
  variantDisplayNames,
  datasetId,
  completedTargetOutputs,
  completedTargetEvaluatorScores,
}: {
  rowIndex: number;
  datasetEntry: Record<string, unknown>;
  cfg: ComparisonEvaluatorConfig;
  anchorVariant: TargetConfig;
  evaluator: EvaluatorConfig;
  variantIds: string[];
  variantDisplayNames: string[];
  datasetId: string;
  completedTargetOutputs: Map<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
  completedTargetEvaluatorScores?: Map<string, ComparisonScoreSample[]>;
}): { cell: ExecutionCell } | { skip: ComparisonSkipReason } => {
  const built = buildComparisonCandidates({
    cfg,
    variantIds,
    variantDisplayNames,
    rowIndex,
    completedTargetOutputs,
    completedTargetEvaluatorScores,
  });

  if (built.missing || built.empty) {
    return {
      skip: {
        rowIndex,
        targetId: anchorVariant.id,
        evaluatorId: evaluator.id,
        kind: built.missing ? "missing-output" : "empty-output",
        variantNames: built.missing ?? built.empty,
      },
    };
  }

  return {
    cell: {
      rowIndex,
      // Point at the first variant so the workflow builder has a real
      // TargetConfig. The target step itself is skipped via `skipTarget`.
      targetId: anchorVariant.id,
      targetConfig: anchorVariant,
      evaluatorConfigs: [evaluator],
      datasetEntry: {
        _datasetId: datasetId,
        ...datasetEntry,
      },
      skipTarget: true,
      precomputedTargetOutput: built.candidates!.candidates[0]!.output,
      comparison: built.candidates,
    },
  };
};

type ChipComparisonEvaluatorSetup = {
  cfg: ComparisonEvaluatorConfig;
  anchorVariant: TargetConfig;
  variantIds: string[];
  variantDisplayNames: string[];
};

const resolveChipComparisonSetup = ({
  evaluator,
  state,
  loadedPrompts,
  loadedEvaluators,
}: {
  evaluator: EvaluatorConfig;
  state: GenerateCellsState;
  loadedPrompts?: Map<string, VersionedPrompt>;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
}): ChipComparisonEvaluatorSetup | undefined => {
  const cfg = toComparisonConfig(evaluator);
  if (!cfg) return undefined;

  const resolvedVariants = resolveComparisonVariants({
    cfg,
    ownerId: evaluator.id,
    state,
  });
  if (!resolvedVariants) return undefined;

  return {
    cfg,
    anchorVariant: resolvedVariants[0]!,
    variantIds: buildVariantIdentifiers({ resolvedVariants, loadedPrompts }),
    variantDisplayNames: buildVariantDisplayNames({
      resolvedVariants,
      loadedPrompts,
      loadedEvaluators,
    }),
  };
};

const buildChipComparisonCellsForEvaluator = ({
  evaluator,
  setup,
  datasetRows,
  rowsInScope,
  datasetId,
  completedTargetOutputs,
  completedTargetEvaluatorScores,
}: {
  evaluator: EvaluatorConfig;
  setup: ChipComparisonEvaluatorSetup;
  datasetRows: Array<Record<string, unknown>>;
  rowsInScope: number[];
  datasetId: string;
  completedTargetOutputs: Map<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
  completedTargetEvaluatorScores?: Map<string, ComparisonScoreSample[]>;
}): { cells: ExecutionCell[]; skipReasons: ComparisonSkipReason[] } => {
  const cells: ExecutionCell[] = [];
  const skipReasons: ComparisonSkipReason[] = [];

  for (const rowIndex of rowsInScope) {
    const datasetEntry = datasetRows[rowIndex];
    if (!datasetEntry) continue;

    const result = buildChipComparisonRow({
      rowIndex,
      datasetEntry,
      cfg: setup.cfg,
      anchorVariant: setup.anchorVariant,
      evaluator,
      variantIds: setup.variantIds,
      variantDisplayNames: setup.variantDisplayNames,
      datasetId,
      completedTargetOutputs,
      completedTargetEvaluatorScores,
    });

    if ("skip" in result) {
      skipReasons.push(result.skip);
    } else {
      cells.push(result.cell);
    }
  }

  return { cells, skipReasons };
};

const buildChipComparisonCells = ({
  state,
  datasetRows,
  rowsInScope,
  datasetId,
  loadedPrompts,
  loadedEvaluators,
  completedTargetOutputs,
  completedTargetEvaluatorScores,
}: {
  state: GenerateCellsState;
  datasetRows: Array<Record<string, unknown>>;
  rowsInScope: number[];
  datasetId: string;
  loadedPrompts?: Map<string, VersionedPrompt>;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  completedTargetOutputs: Map<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
  completedTargetEvaluatorScores?: Map<string, ComparisonScoreSample[]>;
}): { cells: ExecutionCell[]; skipReasons: ComparisonSkipReason[] } => {
  const cells: ExecutionCell[] = [];
  const skipReasons: ComparisonSkipReason[] = [];

  for (const evaluator of state.evaluators) {
    const setup = resolveChipComparisonSetup({
      evaluator,
      state,
      loadedPrompts,
      loadedEvaluators,
    });
    if (!setup) continue;

    const result = buildChipComparisonCellsForEvaluator({
      evaluator,
      setup,
      datasetRows,
      rowsInScope,
      datasetId,
      completedTargetOutputs,
      completedTargetEvaluatorScores,
    });
    cells.push(...result.cells);
    skipReasons.push(...result.skipReasons);
  }

  return { cells, skipReasons };
};

/**
 * `input` falls back to the golden field for datasets with no literal
 * "input" column — a pre-existing convention (#5100) that predates the
 * golden-answer toggle. Since #5378 lets goldenField be undefined when
 * hasGoldenAnswer is off, that fallback is now a no-op for such rows;
 * log it so a silently-empty judge prompt is at least diagnosable
 * instead of indistinguishable from "row has no input, by design."
 */
const resolveComparisonRowInput = ({
  cfg,
  datasetEntry,
  targetId,
  rowIndex,
}: {
  cfg: ComparisonEvaluatorConfig;
  datasetEntry: Record<string, unknown>;
  targetId: string;
  rowIndex: number;
}): unknown => {
  const resolvedInput =
    (cfg.inputField ? datasetEntry[cfg.inputField] : undefined) ??
    datasetEntry.input ??
    (cfg.goldenField ? datasetEntry[cfg.goldenField] : undefined);
  if (resolvedInput === undefined && !cfg.hasGoldenAnswer && rowIndex === 0) {
    logger.debug(
      { targetId },
      "Comparison column-target: no 'input' dataset column and no golden field to fall back on (has_golden_answer is off) — judge prompt will render an empty task/input",
    );
  }
  return resolvedInput;
};

/**
 * Same #5378 gate buildEvaluatorInputs applies at runtime
 * (hasGoldenAnswer !== false && goldenField). Without it here too, a
 * legacy pairwise config folded in with hasGoldenAnswer false but a
 * stale non-empty goldenField (fromPairwise copies it verbatim) would
 * still bake a golden reference into this synthetic's static value
 * mapping while the runtime path correctly omits it — the two
 * disagreeing on the same config.
 */
const resolveComparisonGoldenValue = ({
  cfg,
  datasetEntry,
}: {
  cfg: ComparisonEvaluatorConfig;
  datasetEntry: Record<string, unknown>;
}): unknown =>
  cfg.hasGoldenAnswer !== false && cfg.goldenField
    ? datasetEntry[cfg.goldenField]
    : undefined;

type ComparisonValueMapping = Record<
  string,
  Record<string, Record<string, { type: "value"; value: unknown }>>
>;

/**
 * Per-row synthetic evaluator with PRE-RESOLVED value mappings for every
 * judge input. Pre-fix (#5131) the synthetic was shared across rows with
 * `mappings: {}`, leaving the candidate fields to be filled in by
 * buildEvaluatorInputs and propagated as manual inputs. That path
 * silently dropped them on the wire — the route's downstream
 * `getEvaluatorDataForParams` rebuilt `data` from the default schema,
 * stripping everything not value-mapped at build time. Embedding the
 * candidates as `value` mappings here means buildEvaluatorNode bakes
 * them into the workflow node's static inputs (and the mapping-branch
 * fallback in buildEvaluatorInputs sees them too), so they always reach
 * the judge regardless of which dispatch path is taken.
 *
 * The shape baked here must match whichever judge will ACTUALLY run —
 * the legacy 2-slot `candidate_a_id/output` + `candidate_b_id/output`
 * shape when `legacyPairwise`, or the N-way `candidates` shape
 * otherwise. See isLegacyPairwiseBacked's JSDoc for why the DB row,
 * not this cell's in-memory config, decides which judge runs.
 */
const buildColumnComparisonMappings = ({
  datasetId,
  targetId,
  legacyPairwise,
  variantIds,
  candidates,
  rowIndex,
  resolvedInput,
  goldenValue,
}: {
  datasetId: string;
  targetId: string;
  legacyPairwise: boolean;
  variantIds: string[];
  candidates: NonNullable<ExecutionCell["comparison"]>["candidates"];
  rowIndex: number;
  resolvedInput: unknown;
  goldenValue: unknown;
}): ComparisonValueMapping => {
  const [candidateA, candidateB] = candidates;
  return {
    [datasetId]: {
      [targetId]: legacyPairwise
        ? {
            candidate_a_id: { type: "value", value: variantIds[0] },
            candidate_a_output: { type: "value", value: candidateA?.output },
            candidate_a_cost: { type: "value", value: candidateA?.cost },
            candidate_a_duration: {
              type: "value",
              value: candidateA?.duration,
            },
            candidate_b_id: { type: "value", value: variantIds[1] },
            candidate_b_output: { type: "value", value: candidateB?.output },
            candidate_b_cost: { type: "value", value: candidateB?.cost },
            candidate_b_duration: {
              type: "value",
              value: candidateB?.duration,
            },
            input: { type: "value", value: resolvedInput },
            golden: { type: "value", value: goldenValue },
          }
        : {
            candidates: { type: "value", value: candidates },
            row_index: { type: "value", value: rowIndex },
            input: { type: "value", value: resolvedInput },
            golden: { type: "value", value: goldenValue },
          },
    },
  };
};

const buildColumnComparisonSyntheticEvaluator = ({
  target,
  legacyPairwise,
  cfg,
  perRowMappings,
}: {
  target: TargetConfig;
  legacyPairwise: boolean;
  cfg: ComparisonEvaluatorConfig;
  perRowMappings: ComparisonValueMapping;
}): EvaluatorConfig =>
  ({
    id: target.id,
    dbEvaluatorId: target.targetEvaluatorId,
    // Mirror the judge that will ACTUALLY run (see
    // isLegacyPairwiseBacked), not what a freshly-created column would
    // use — forcing COMPARISON_EVALUATOR_TYPE unconditionally here is
    // what caused #5528's re-run regression for untouched legacy
    // pairwise experiments (the payload above was always the N-way
    // shape, dispatched to a judge that still expects the 2-slot one).
    evaluatorType: legacyPairwise
      ? LEGACY_PAIRWISE_EVALUATOR_TYPE
      : COMPARISON_EVALUATOR_TYPE,
    comparison: cfg,
    inputs: target.inputs,
    mappings: perRowMappings,
  }) as unknown as EvaluatorConfig;

/**
 * Column-style comparison targets. Each is its own column whose verdict is
 * stored under TargetId=column-target.id rather than under a variant. A
 * synthetic EvaluatorConfig (from the target's comparison config +
 * targetEvaluatorId) gives buildEvaluatorInputs everything it needs.
 */
const buildColumnComparisonRow = ({
  rowIndex,
  datasetEntry,
  cfg,
  target,
  variantIds,
  variantDisplayNames,
  legacyPairwise,
  datasetId,
  completedTargetOutputs,
  completedTargetEvaluatorScores,
}: {
  rowIndex: number;
  datasetEntry: Record<string, unknown>;
  cfg: ComparisonEvaluatorConfig;
  target: TargetConfig;
  variantIds: string[];
  variantDisplayNames: string[];
  legacyPairwise: boolean;
  datasetId: string;
  completedTargetOutputs: Map<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
  completedTargetEvaluatorScores?: Map<string, ComparisonScoreSample[]>;
}): { cell: ExecutionCell } | { skip: ComparisonSkipReason } => {
  const built = buildComparisonCandidates({
    cfg,
    variantIds,
    variantDisplayNames,
    rowIndex,
    completedTargetOutputs,
    completedTargetEvaluatorScores,
  });

  if (built.missing || built.empty) {
    return {
      skip: {
        rowIndex,
        targetId: target.id,
        evaluatorId: target.id,
        kind: built.missing ? "missing-output" : "empty-output",
        variantNames: built.missing ?? built.empty,
      },
    };
  }

  const candidates = built.candidates!.candidates;
  const resolvedInput = resolveComparisonRowInput({
    cfg,
    datasetEntry,
    targetId: target.id,
    rowIndex,
  });
  const goldenValue = resolveComparisonGoldenValue({ cfg, datasetEntry });

  const perRowMappings = buildColumnComparisonMappings({
    datasetId,
    targetId: target.id,
    legacyPairwise,
    variantIds,
    candidates,
    rowIndex,
    resolvedInput,
    goldenValue,
  });

  const syntheticEvaluator = buildColumnComparisonSyntheticEvaluator({
    target,
    legacyPairwise,
    cfg,
    perRowMappings,
  });

  return {
    cell: {
      rowIndex,
      // Use the column-target's id so the verdict lands in the comparison
      // column rather than under the first variant. Differs from the
      // chip-style path above, where verdicts hang under that variant.
      targetId: target.id,
      targetConfig: target,
      evaluatorConfigs: [syntheticEvaluator],
      datasetEntry: {
        _datasetId: datasetId,
        ...datasetEntry,
      },
      skipTarget: true,
      precomputedTargetOutput: candidates[0]!.output,
      comparison: built.candidates,
    },
  };
};

type ColumnComparisonTargetSetup = {
  cfg: ComparisonEvaluatorConfig;
  variantIds: string[];
  variantDisplayNames: string[];
  legacyPairwise: boolean;
};

const resolveColumnComparisonSetup = ({
  target,
  state,
  loadedPrompts,
  loadedEvaluators,
}: {
  target: TargetConfig;
  state: GenerateCellsState;
  loadedPrompts?: Map<string, VersionedPrompt>;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
}): ColumnComparisonTargetSetup | undefined => {
  if (target.type !== "evaluator") return undefined;
  const cfg = toComparisonConfig(target);
  if (!cfg || !target.targetEvaluatorId) return undefined;

  // Variant-count and golden-field gating (#5378) now live in
  // resolveComparisonVariants, shared with the chip-style loop above — a
  // column-target the user hasn't finished configuring (fewer than two
  // variants, or a golden field the settings claim but didn't pick) is
  // skipped the same way a chip-style comparison would be, rather than
  // hitting the judge endpoint and rendering a verdict-shaped 400 error.
  const resolvedVariants = resolveComparisonVariants({
    cfg,
    ownerId: target.id,
    state,
  });
  if (!resolvedVariants) return undefined;

  const variantIds = buildVariantIdentifiers({
    resolvedVariants,
    loadedPrompts,
  });

  // Resolved once per target (not per row): whether the DB evaluator this
  // column dispatches to is still the legacy 2-slot judge. See
  // isLegacyPairwiseBacked's JSDoc for why this can't just read
  // COMPARISON_EVALUATOR_TYPE off the target/cfg.
  const legacyPairwise =
    isLegacyPairwiseBacked({
      dbEvaluatorId: target.targetEvaluatorId,
      loadedEvaluators,
    }) && variantIds.length === 2;

  return {
    cfg,
    variantIds,
    variantDisplayNames: buildVariantDisplayNames({
      resolvedVariants,
      loadedPrompts,
      loadedEvaluators,
    }),
    legacyPairwise,
  };
};

const buildColumnComparisonCellsForTarget = ({
  target,
  setup,
  datasetRows,
  rowsInScope,
  datasetId,
  completedTargetOutputs,
  completedTargetEvaluatorScores,
}: {
  target: TargetConfig;
  setup: ColumnComparisonTargetSetup;
  datasetRows: Array<Record<string, unknown>>;
  rowsInScope: number[];
  datasetId: string;
  completedTargetOutputs: Map<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
  completedTargetEvaluatorScores?: Map<string, ComparisonScoreSample[]>;
}): { cells: ExecutionCell[]; skipReasons: ComparisonSkipReason[] } => {
  const cells: ExecutionCell[] = [];
  const skipReasons: ComparisonSkipReason[] = [];

  for (const rowIndex of rowsInScope) {
    const datasetEntry = datasetRows[rowIndex];
    if (!datasetEntry) continue;

    const result = buildColumnComparisonRow({
      rowIndex,
      datasetEntry,
      cfg: setup.cfg,
      target,
      variantIds: setup.variantIds,
      variantDisplayNames: setup.variantDisplayNames,
      legacyPairwise: setup.legacyPairwise,
      datasetId,
      completedTargetOutputs,
      completedTargetEvaluatorScores,
    });

    if ("skip" in result) {
      skipReasons.push(result.skip);
    } else {
      cells.push(result.cell);
    }
  }

  return { cells, skipReasons };
};

const buildColumnComparisonCells = ({
  state,
  datasetRows,
  rowsInScope,
  datasetId,
  loadedPrompts,
  loadedEvaluators,
  completedTargetOutputs,
  completedTargetEvaluatorScores,
}: {
  state: GenerateCellsState;
  datasetRows: Array<Record<string, unknown>>;
  rowsInScope: number[];
  datasetId: string;
  loadedPrompts?: Map<string, VersionedPrompt>;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  completedTargetOutputs: Map<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
  completedTargetEvaluatorScores?: Map<string, ComparisonScoreSample[]>;
}): { cells: ExecutionCell[]; skipReasons: ComparisonSkipReason[] } => {
  const cells: ExecutionCell[] = [];
  const skipReasons: ComparisonSkipReason[] = [];

  for (const target of state.targets) {
    const setup = resolveColumnComparisonSetup({
      target,
      state,
      loadedPrompts,
      loadedEvaluators,
    });
    if (!setup) continue;

    const result = buildColumnComparisonCellsForTarget({
      target,
      setup,
      datasetRows,
      rowsInScope,
      datasetId,
      completedTargetOutputs,
      completedTargetEvaluatorScores,
    });
    cells.push(...result.cells);
    skipReasons.push(...result.skipReasons);
  }

  return { cells, skipReasons };
};

export const generateComparisonCells = ({
  state,
  datasetRows,
  completedTargetOutputs,
  completedTargetEvaluatorScores,
  loadedPrompts,
  loadedEvaluators,
  scopedRowIndices,
}: {
  state: GenerateCellsState;
  datasetRows: Array<Record<string, unknown>>;
  completedTargetOutputs: Map<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
  completedTargetEvaluatorScores?: Map<string, ComparisonScoreSample[]>;
  loadedPrompts?: Map<string, VersionedPrompt>;
  /**
   * DB evaluators, keyed by id — used to detect a column-target whose backing
   * evaluator row is still the legacy `pairwise_compare` judge (see
   * `isLegacyPairwiseBacked` below). When omitted, column-targets are treated
   * as current-shape comparisons.
   */
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  /**
   * Rows this run is scoped to; omit to mean every row.
   *
   * Required rather than optional-with-a-default, because the failure mode of
   * forgetting it is silent and destructive: comparison cells for out-of-scope
   * rows emit "waiting on …" skips that overwrite verdicts the user never asked
   * to re-run. An explicit `undefined` at the call site is a decision; a missing
   * argument is an oversight, and the two should not look the same.
   */
  scopedRowIndices: number[] | undefined;
}): { cells: ExecutionCell[]; skipReasons: ComparisonSkipReason[] } => {
  const datasetId =
    state.datasets[0]?.id ?? state.activeDatasetId ?? "dataset-1";
  const rowsInScope =
    scopedRowIndices ?? datasetRows.map((_, rowIndex) => rowIndex);

  const chip = buildChipComparisonCells({
    state,
    datasetRows,
    rowsInScope,
    datasetId,
    loadedPrompts,
    loadedEvaluators,
    completedTargetOutputs,
    completedTargetEvaluatorScores,
  });
  const column = buildColumnComparisonCells({
    state,
    datasetRows,
    rowsInScope,
    datasetId,
    loadedPrompts,
    loadedEvaluators,
    completedTargetOutputs,
    completedTargetEvaluatorScores,
  });

  return {
    cells: [...chip.cells, ...column.cells],
    skipReasons: [...chip.skipReasons, ...column.skipReasons],
  };
};

/**
 * Prices an LLM node's token usage at the project's canonical model rate.
 *
 * The engine surfaces token counts + the resolved model on the execution state
 * but no cost (it has no price table). This derives the cost the same way the
 * trace-ingest collector does, so a cell's cost matches its trace's cost.
 * Returns undefined when there is no model, no tokens, or no known rate.
 */
export const priceMetrics = async (
  projectId: string,
  metrics: ExecutionState["metrics"] | undefined,
): Promise<number | undefined> => {
  if (!metrics?.model) return undefined;
  const inputTokens = metrics.prompt_tokens ?? 0;
  const outputTokens = metrics.completion_tokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return undefined;
  const llmModelCost = await getMatchingLLMModelCost(projectId, metrics.model);
  if (!llmModelCost) return undefined;
  return estimateCost({ llmModelCost, inputTokens, outputTokens });
};

type CellTargetExecutionResult = {
  targetOutput: Record<string, unknown> | undefined;
  targetFailed: boolean;
};

/**
 * Converts precomputedTargetOutput to the expected format: the target output
 * should be a record with the output field identifier as key.
 */
const resolvePrecomputedTargetOutput = (
  cell: ExecutionCell,
): Record<string, unknown> => {
  if (
    typeof cell.precomputedTargetOutput === "object" &&
    cell.precomputedTargetOutput !== null
  ) {
    return cell.precomputedTargetOutput as Record<string, unknown>;
  }
  // If it's a primitive value, wrap it in the expected output field
  const outputField = cell.targetConfig.outputs?.[0]?.identifier ?? "output";
  return { [outputField]: cell.precomputedTargetOutput };
};

/** Executes a cell's target node normally (not pre-computed) and yields its mapped events. */
async function* executeCellTargetNode({
  cell,
  projectId,
  workflow,
  targetNodeId,
  targetNodes,
  cellConfig,
  traceId,
  isAborted,
}: {
  cell: ExecutionCell;
  projectId: string;
  workflow: Workflow;
  targetNodeId: string;
  targetNodes: Set<string>;
  cellConfig: ResultMapperConfig;
  traceId: string;
  isAborted?: () => Promise<boolean>;
}): AsyncGenerator<EvaluationV3Event, CellTargetExecutionResult> {
  // Create the execute_component event for the target
  const rawEvent = {
    type: "execute_component" as const,
    payload: {
      trace_id: traceId,
      workflow: {
        ...workflow,
        state: { execution: { status: "idle" as const } },
      },
      node_id: targetNodeId,
      inputs: buildTargetInputs(cell),
      origin: "evaluation",
    },
  };

  // Add environment variables and process datasets
  const enrichedEvent = await loadDatasets(
    await addEnvs(rawEvent, projectId),
    projectId,
  );

  // Execute target and collect events
  const targetEvents: StudioServerEvent[] = [];
  let targetOutput: Record<string, unknown> | undefined;
  let targetFailed = false;

  await studioBackendPostEvent({
    projectId,
    message: enrichedEvent,
    isAborted,
    onEvent: (serverEvent) => {
      targetEvents.push(serverEvent);

      // Extract target output from success event
      if (
        serverEvent.type === "component_state_change" &&
        serverEvent.payload.component_id === targetNodeId &&
        serverEvent.payload.execution_state?.status === "success"
      ) {
        targetOutput = serverEvent.payload.execution_state.outputs;
      } else if (
        serverEvent.type === "component_state_change" &&
        serverEvent.payload.component_id === targetNodeId &&
        serverEvent.payload.execution_state?.status === "error"
      ) {
        targetFailed = true;
      }
    },
  });

  // Map and yield target events
  for (const event of targetEvents) {
    const mappedEvent = mapNlpEvent({
      event,
      rowIndex: cell.rowIndex,
      targetNodes,
      config: cellConfig,
    });
    if (!mappedEvent) continue;
    // The engine reports token usage but no cost (it has no price table),
    // so price the target's tokens here at the canonical model rate. This
    // keeps the cell's cost consistent with its trace's cost.
    if (
      mappedEvent.type === "target_result" &&
      mappedEvent.cost == null &&
      event.type === "component_state_change"
    ) {
      const cost = await priceMetrics(
        projectId,
        event.payload.execution_state?.metrics,
      );
      if (cost != null) mappedEvent.cost = cost;
    }
    yield mappedEvent;
  }

  return { targetOutput, targetFailed };
}

/** Resolves the cell's target output, either pre-computed or by executing the target node. */
async function* resolveCellTargetOutput({
  cell,
  projectId,
  workflow,
  targetNodeId,
  targetNodes,
  cellConfig,
  traceId,
  isAborted,
}: {
  cell: ExecutionCell;
  projectId: string;
  workflow: Workflow;
  targetNodeId: string;
  targetNodes: Set<string>;
  cellConfig: ResultMapperConfig;
  traceId: string;
  isAborted?: () => Promise<boolean>;
}): AsyncGenerator<EvaluationV3Event, CellTargetExecutionResult> {
  // If skipTarget is true, use pre-computed output instead of executing target
  if (cell.skipTarget && cell.precomputedTargetOutput !== undefined) {
    logger.debug(
      { rowIndex: cell.rowIndex, targetId: cell.targetId },
      "Skipping target execution, using pre-computed output",
    );
    return {
      targetOutput: resolvePrecomputedTargetOutput(cell),
      targetFailed: false,
    };
  }

  return yield* executeCellTargetNode({
    cell,
    projectId,
    workflow,
    targetNodeId,
    targetNodes,
    cellConfig,
    traceId,
    isAborted,
  });
}

/** Executes one evaluator node and yields its mapped events, catching and yielding a failure event instead of throwing. */
async function* executeCellEvaluator({
  cell,
  projectId,
  workflow,
  evaluatorId,
  evaluatorNodeId,
  targetNodes,
  cellConfig,
  traceId,
  targetOutput,
  isAborted,
}: {
  cell: ExecutionCell;
  projectId: string;
  workflow: Workflow;
  evaluatorId: string;
  evaluatorNodeId: string;
  targetNodes: Set<string>;
  cellConfig: ResultMapperConfig;
  traceId: string;
  targetOutput: Record<string, unknown>;
  isAborted?: () => Promise<boolean>;
}): AsyncGenerator<EvaluationV3Event> {
  try {
    // Build evaluator inputs from target output and dataset
    const evaluatorInputs = buildEvaluatorInputs(
      cell,
      evaluatorId,
      targetOutput,
    );

    // Create execute_component event for evaluator
    const evaluatorEvent = {
      type: "execute_component" as const,
      payload: {
        trace_id: traceId,
        workflow: {
          ...workflow,
          state: { execution: { status: "idle" as const } },
        },
        node_id: evaluatorNodeId,
        inputs: evaluatorInputs,
        origin: "evaluation",
      },
    };

    // Add environment variables
    const enrichedEvaluatorEvent = await addEnvs(evaluatorEvent, projectId);

    // Execute evaluator
    const evaluatorEvents: StudioServerEvent[] = [];
    await studioBackendPostEvent({
      projectId,
      message: enrichedEvaluatorEvent,
      isAborted,
      onEvent: (serverEvent) => {
        evaluatorEvents.push(serverEvent);
      },
    });

    // Map and yield evaluator events
    for (const event of evaluatorEvents) {
      const mappedEvent = mapNlpEvent({
        event,
        rowIndex: cell.rowIndex,
        targetNodes,
        config: cellConfig,
        evaluatorInputs,
      });
      if (mappedEvent) {
        yield mappedEvent;
      }
    }
  } catch (evalError) {
    // Yield error for this evaluator but continue with others
    logger.warn(
      {
        error: evalError,
        evaluatorId,
        rowIndex: cell.rowIndex,
        targetId: cell.targetId,
      },
      "Evaluator execution failed",
    );
    yield {
      type: "evaluator_result",
      rowIndex: cell.rowIndex,
      targetId: cell.targetId,
      evaluatorId,
      result: {
        status: "error",
        error_type: "EvaluatorError",
        details:
          evalError instanceof Error
            ? evalError.message
            : "Evaluator execution failed",
        traceback: [],
        ...(HandledError.isHandled(evalError)
          ? { domainError: evalError.serialize() }
          : {}),
      },
    };
  }
}

/** Runs the abort-gated evaluators phase: one node per configured evaluator, in order. */
async function* executeCellEvaluatorsPhase({
  cell,
  projectId,
  workflow,
  evaluatorNodeIds,
  targetNodes,
  cellConfig,
  traceId,
  targetOutput,
  targetFailed,
  isAborted,
}: {
  cell: ExecutionCell;
  projectId: string;
  workflow: Workflow;
  evaluatorNodeIds: Record<string, string>;
  targetNodes: Set<string>;
  cellConfig: ResultMapperConfig;
  traceId: string;
  targetOutput: Record<string, unknown> | undefined;
  targetFailed: boolean;
  isAborted?: () => Promise<boolean>;
}): AsyncGenerator<EvaluationV3Event> {
  // Check abort before executing evaluators
  if (isAborted && (await isAborted())) {
    logger.debug(
      { cell: cell.rowIndex, targetId: cell.targetId },
      "Cell aborted after target execution",
    );
    return;
  }

  // Execute evaluators if target succeeded and we have evaluators
  if (
    !targetFailed &&
    targetOutput &&
    Object.keys(evaluatorNodeIds).length > 0
  ) {
    for (const [evaluatorId, evaluatorNodeId] of Object.entries(
      evaluatorNodeIds,
    )) {
      // Check abort before each evaluator
      if (isAborted && (await isAborted())) {
        logger.debug(
          { cell: cell.rowIndex, evaluatorId },
          "Cell aborted before evaluator execution",
        );
        return;
      }
      yield* executeCellEvaluator({
        cell,
        projectId,
        workflow,
        evaluatorId,
        evaluatorNodeId,
        targetNodes,
        cellConfig,
        traceId,
        targetOutput,
        isAborted,
      });
    }
  }
}

/**
 * Executes a single cell and yields events.
 * @param isAborted - Optional function to check if execution should be aborted
 */
export async function* executeCell({
  cell,
  projectId,
  datasetColumns,
  loadedData,
  resultMapperConfig,
  isAborted,
}: {
  cell: ExecutionCell;
  projectId: string;
  datasetColumns: Array<{ id: string; name: string; type: string }>;
  loadedData: {
    prompt?: VersionedPrompt;
    agent?: TypedAgent;
    evaluators?: Map<string, { id: string; name: string; config: unknown }>;
  };
  resultMapperConfig?: ResultMapperConfig;
  isAborted?: () => Promise<boolean>;
}): AsyncGenerator<EvaluationV3Event> {
  // Emit cell_started
  yield {
    type: "cell_started",
    rowIndex: cell.rowIndex,
    targetId: cell.targetId,
  };

  try {
    // Build the workflow
    const { workflow, targetNodeId, evaluatorNodeIds } = buildCellWorkflow(
      {
        projectId,
        cell,
        datasetColumns,
      },
      loadedData,
    );

    // Create set of target nodes for the result mapper
    const targetNodes = new Set([cell.targetId]);

    // Build evaluator target node IDs for explicit evaluator-as-target detection
    const cellConfig: ResultMapperConfig = {
      ...resultMapperConfig,
      evaluatorTargetNodeIds:
        cell.targetConfig.type === "evaluator"
          ? new Set([cell.targetId])
          : undefined,
    };

    // Generate OTEL-compliant trace ID for this cell execution
    // Reuse existing traceId if provided (for evaluator reruns to append to existing trace)
    const traceId = cell.traceId ?? generateOtelTraceId();

    const { targetOutput, targetFailed } = yield* resolveCellTargetOutput({
      cell,
      projectId,
      workflow,
      targetNodeId,
      targetNodes,
      cellConfig,
      traceId,
      isAborted,
    });

    yield* executeCellEvaluatorsPhase({
      cell,
      projectId,
      workflow,
      evaluatorNodeIds,
      targetNodes,
      cellConfig,
      traceId,
      targetOutput,
      targetFailed,
      isAborted,
    });
  } catch (error) {
    logger.error(
      { error, rowIndex: cell.rowIndex, targetId: cell.targetId },
      "Cell execution failed",
    );
    yield mapThrownErrorEvent({
      error,
      rowIndex: cell.rowIndex,
      targetId: cell.targetId,
    });
  }
}

const buildExecuteFlowEvent = ({
  workflowDsl,
  traceId,
  inputs,
}: {
  workflowDsl: Workflow;
  traceId: string;
  inputs: Record<string, unknown>;
}) => ({
  type: "execute_flow" as const,
  payload: {
    trace_id: traceId,
    workflow: {
      ...workflowDsl,
      state: { execution: { status: "idle" as const } },
    },
    inputs: [inputs],
    manual_execution_mode: false,
    do_not_trace: false,
    run_evaluations: true,
    origin: "evaluation",
  },
});

type WorkflowCellExecutionState = {
  targetOutput: unknown;
  totalCost: number;
  sawCost: boolean;
  targetFailed: boolean;
  /**
   * The failing state, captured whole.
   *
   * One assignment, not three latches: message, code and upstream status
   * describe ONE failure. Latching them independently (`ex.error ?? previous`
   * and so on) let a state carrying only `error` be followed by one carrying
   * only `error_type`, yielding a `domainError` whose code came from one node
   * and whose message came from another.
   */
  targetFailure?: {
    error?: string;
    errorType?: string;
    upstreamStatus?: number;
  };
  durationMs?: number;
  finalTraceId: string;
  evaluatorEvents: EvaluationV3Event[];
};

/**
 * Applies an `execution_state_change` event (the workflow's own top-level
 * run state) onto the accumulator: target output, trace id, duration, and
 * failure detail.
 */
const applyWorkflowExecutionStateChange = ({
  event,
  state,
}: {
  event: Extract<StudioServerEvent, { type: "execution_state_change" }>;
  state: WorkflowCellExecutionState;
}): void => {
  const ex = event.payload.execution_state;
  if (ex?.result !== undefined) {
    state.targetOutput = extractTargetOutput(ex.result);
  }
  if (ex?.trace_id) state.finalTraceId = ex.trace_id;
  if (
    ex?.timestamps?.started_at !== undefined &&
    ex?.timestamps?.finished_at !== undefined
  ) {
    state.durationMs = ex.timestamps.finished_at - ex.timestamps.started_at;
  }
  if (ex?.status === "error") {
    state.targetFailed = true;
    state.targetFailure = {
      error: ex.error,
      errorType: ex.error_type,
      upstreamStatus: ex.upstream_status,
    };
  }
};

/**
 * Applies a `component_state_change` event: accumulates node cost (pricing
 * LLM token usage when the engine didn't report a cost directly) and, for
 * the workflow's own evaluator nodes, records the mapped evaluator_result
 * event to yield after the target result.
 */
const applyWorkflowComponentStateChange = async ({
  event,
  projectId,
  cell,
  evaluatorNodeNames,
  state,
}: {
  event: Extract<StudioServerEvent, { type: "component_state_change" }>;
  projectId: string;
  cell: ExecutionCell;
  evaluatorNodeNames: Map<string, string | undefined>;
  state: WorkflowCellExecutionState;
}): Promise<void> => {
  const { component_id, execution_state } = event.payload;
  if (!execution_state) return;

  if (typeof execution_state.cost === "number" && execution_state.cost > 0) {
    state.totalCost += execution_state.cost;
    state.sawCost = true;
  } else {
    // LLM nodes report tokens but no cost (the engine has no price table),
    // so price them at the canonical model rate, same as executeCell.
    const cost = await priceMetrics(projectId, execution_state.metrics);
    if (cost != null) {
      state.totalCost += cost;
      state.sawCost = true;
    }
  }

  if (
    evaluatorNodeNames.has(component_id) &&
    (execution_state.status === "success" || execution_state.status === "error")
  ) {
    state.evaluatorEvents.push(
      mapWorkflowEvaluatorResult({
        rowIndex: cell.rowIndex,
        targetId: cell.targetId,
        evaluatorId: component_id,
        evaluatorName: evaluatorNodeNames.get(component_id),
        executionState: {
          status: execution_state.status,
          outputs: execution_state.outputs,
          cost: execution_state.cost,
          error: execution_state.error,
          // The coded half of the failure — without it the evaluator cell
          // renders the engine's raw message verbatim.
          nodeErrorCode: execution_state.error_type,
          upstream_status: execution_state.upstream_status,
          trace_id: execution_state.trace_id ?? state.finalTraceId,
        },
      }),
    );
  }
};

/** Processes the raw studio events for one workflow-cell run into the accumulator. */
const processWorkflowCellEvents = async ({
  events,
  projectId,
  cell,
  evaluatorNodeNames,
  traceId,
}: {
  events: StudioServerEvent[];
  projectId: string;
  cell: ExecutionCell;
  evaluatorNodeNames: Map<string, string | undefined>;
  traceId: string;
}): Promise<WorkflowCellExecutionState> => {
  const state: WorkflowCellExecutionState = {
    targetOutput: undefined,
    totalCost: 0,
    sawCost: false,
    targetFailed: false,
    targetFailure: undefined,
    durationMs: undefined,
    finalTraceId: traceId,
    evaluatorEvents: [],
  };

  for (const event of events) {
    if (event.type === "execution_state_change") {
      applyWorkflowExecutionStateChange({ event, state });
      continue;
    }

    if (event.type !== "component_state_change") continue;

    await applyWorkflowComponentStateChange({
      event,
      projectId,
      cell,
      evaluatorNodeNames,
      state,
    });
  }

  return state;
};

const buildWorkflowTargetResultEvent = ({
  cell,
  state,
}: {
  cell: ExecutionCell;
  state: WorkflowCellExecutionState;
}): EvaluationV3Event => ({
  type: "target_result",
  rowIndex: cell.rowIndex,
  targetId: cell.targetId,
  output: state.targetOutput,
  cost: state.sawCost ? state.totalCost : undefined,
  duration: state.durationMs,
  traceId: state.finalTraceId,
  // The engine's own words when it gave any; otherwise the marker, so the
  // client's fallback copy owns what the customer reads rather than a
  // sentence written here.
  error: state.targetFailed
    ? (state.targetFailure?.error ?? UNNAMED_FAILURE)
    : undefined,
  ...(state.targetFailed && state.targetFailure?.errorType
    ? {
        domainError: nodeErrorToDomainError({
          errorType: state.targetFailure.errorType,
          message: state.targetFailure.error,
          upstreamStatus: state.targetFailure.upstreamStatus,
          traceId: state.finalTraceId,
        }),
      }
    : {}),
});

/**
 * Executes a single cell whose target is a whole studio workflow.
 *
 * Runs the committed workflow DSL once for the row via execute_flow (the
 * run-whole-workflow primitive), then surfaces the workflow's End-node result
 * as the target output and each of the workflow's own evaluator nodes as an
 * evaluator result. This replaces the legacy nlpgo execute_evaluation loop,
 * keeping orchestration (parallelism, abort, storage) in TypeScript.
 */
export async function* executeWorkflowCell({
  cell,
  projectId,
  workflowDsl,
  isAborted,
}: {
  cell: ExecutionCell;
  projectId: string;
  workflowDsl: Workflow;
  isAborted?: () => Promise<boolean>;
}): AsyncGenerator<EvaluationV3Event> {
  yield {
    type: "cell_started",
    rowIndex: cell.rowIndex,
    targetId: cell.targetId,
  };

  try {
    const traceId = cell.traceId ?? generateOtelTraceId();
    const inputs = buildTargetInputs(cell);

    // The workflow's own evaluator nodes carry the scores we surface per row.
    // Keep each node's display name so results show it (e.g. "Exact Match")
    // instead of the raw node id; these nodes have no DB evaluator to resolve.
    const evaluatorNodeNames = new Map(
      workflowDsl.nodes
        .filter((n) => n.type === "evaluator")
        .map((n) => [n.id, n.data?.name]),
    );

    const rawEvent = buildExecuteFlowEvent({ workflowDsl, traceId, inputs });

    const enrichedEvent = await loadDatasets(
      await addEnvs(rawEvent, projectId),
      projectId,
    );

    const events: StudioServerEvent[] = [];
    await studioBackendPostEvent({
      projectId,
      message: enrichedEvent,
      isAborted,
      onEvent: (serverEvent) => {
        events.push(serverEvent);
      },
    });

    const state = await processWorkflowCellEvents({
      events,
      projectId,
      cell,
      evaluatorNodeNames,
      traceId,
    });

    // Yield the target result first so storage links evaluator results to it.
    yield buildWorkflowTargetResultEvent({ cell, state });

    for (const evaluatorEvent of state.evaluatorEvents) {
      yield evaluatorEvent;
    }
  } catch (error) {
    logger.error(
      { error, rowIndex: cell.rowIndex, targetId: cell.targetId },
      "Workflow cell execution failed",
    );
    yield mapThrownErrorEvent({
      error,
      rowIndex: cell.rowIndex,
      targetId: cell.targetId,
    });
  }
}

// Shared by the pairwise (#5100) and select-best (#5101) branches:
// resolve `inputs.input` from the variant's dataset mapping, or fall back
// to the dataset's `input` column. Kept as a mutating helper (rather than
// a return-then-assign) to preserve the original behavior of setting
// `inputs.input = undefined` when a mapping matches a missing column,
// which downstream consumers already tolerate.
const assignMappedInput = ({
  inputs,
  mappings,
  datasetEntry,
}: {
  inputs: Record<string, unknown>;
  mappings: Record<string, FieldMapping>;
  datasetEntry: Record<string, unknown>;
}): void => {
  const inputMapping = mappings.input;
  if (inputMapping?.type === "source" && inputMapping.source === "dataset") {
    inputs.input = datasetEntry[inputMapping.sourceField];
  } else if (datasetEntry.input !== undefined) {
    inputs.input = datasetEntry.input;
  }
};

/**
 * Builds the input values for an evaluator from target output and dataset entry.
 *
 * Note: Dataset entries are normalized to use column NAMES as keys at the API boundary,
 * so we can use mapping.sourceField directly without ID-to-name translation.
 */
/** Assigns the comparison judge's candidate fields — legacy 2-slot shape, or N-way `candidates` list. */
const assignComparisonCandidateInputs = ({
  inputs,
  evaluator,
  comparison,
  rowIndex,
}: {
  inputs: Record<string, unknown>;
  evaluator: EvaluatorConfig;
  comparison: NonNullable<ExecutionCell["comparison"]>;
  rowIndex: number;
}): void => {
  // The judge that ACTUALLY runs is resolved server-side from the DB
  // evaluator row (workflowBuilder's buildEvaluatorNode always prefers
  // `evaluators/{dbEvaluatorId}`, which ignores this in-memory
  // evaluatorType — see evaluations-legacy.ts). For a column-target,
  // generateComparisonCells resolves `evaluator.evaluatorType` from that
  // same DB row (see isLegacyPairwiseBacked), so it's already accurate
  // here; for a chip-style comparison, `evaluator` is the real persisted
  // EvaluatorConfig, so its evaluatorType is accurate by construction.
  // Either way: a legacy `pairwise_compare` judge expects the two-slot
  // `candidate_a_id/output` + `candidate_b_id/output` shape, not
  // `candidates` — sending the N-way shape 400s ("missing required field:
  // candidate_a_id") on re-running an untouched legacy pairwise
  // experiment.
  if (evaluator.evaluatorType === LEGACY_PAIRWISE_EVALUATOR_TYPE) {
    const [candidateA, candidateB] = comparison.candidates;
    if (candidateA) {
      inputs.candidate_a_id = candidateA.id;
      inputs.candidate_a_output = candidateA.output;
      inputs.candidate_a_cost = candidateA.cost;
      inputs.candidate_a_duration = candidateA.duration;
    }
    if (candidateB) {
      inputs.candidate_b_id = candidateB.id;
      inputs.candidate_b_output = candidateB.output;
      inputs.candidate_b_cost = candidateB.cost;
      inputs.candidate_b_duration = candidateB.duration;
    }
    return;
  }

  inputs.candidates = comparison.candidates.map((c) => ({
    id: c.id,
    output: c.output,
    cost: c.cost,
    duration: c.duration,
  }));
  // Seeds the judge's deterministic candidate shuffle (randomize_order).
  inputs.row_index = rowIndex;
};

/**
 * Defensive fallback: if a candidate value was lost between cell creation
 * and here, pull it from the per-row synthetic value mappings that
 * generateComparisonCells bakes onto column-target cells (#5131). Strictly
 * additive — only fires for fields the primary read left undefined.
 */
const applyComparisonMappingFallback = ({
  inputs,
  evaluator,
  datasetId,
  targetId,
}: {
  inputs: Record<string, unknown>;
  evaluator: EvaluatorConfig;
  datasetId: string;
  targetId: string;
}): void => {
  const cellMappings = evaluator.mappings[datasetId]?.[targetId] ?? {};
  for (const [field, mapping] of Object.entries(cellMappings)) {
    if (
      mapping.type === "value" &&
      mapping.value !== undefined &&
      inputs[field] === undefined
    ) {
      inputs[field] = mapping.value;
    }
  }
};

/**
 * Comparison branch: synthetic inputs bypassing the per-target mapping
 * system. We know explicitly where each field comes from (golden ->
 * dataset[goldenField]; candidates -> cell.comparison), so we assemble them
 * directly. `input` still reuses the first variant's existing mapping when
 * one is configured, so dataset-side input renaming keeps working;
 * otherwise it falls back to the dataset's `input` column.
 */
const buildComparisonEvaluatorInputs = ({
  cell,
  evaluator,
  comparisonConfig,
  datasetId,
}: {
  cell: ExecutionCell;
  evaluator: EvaluatorConfig;
  comparisonConfig: ComparisonEvaluatorConfig;
  datasetId: string;
}): Record<string, unknown> => {
  const inputs: Record<string, unknown> = {};
  const firstVariantId = comparisonConfig.variants[0];
  const firstVariantMappings = firstVariantId
    ? (evaluator.mappings[datasetId]?.[firstVariantId] ?? {})
    : {};
  assignMappedInput({
    inputs,
    mappings: firstVariantMappings,
    datasetEntry: cell.datasetEntry,
  });

  // Golden is optional (#5378). Only send it when the user opted into
  // golden-answer comparison AND picked a column. Missing either → the
  // judge sees no reference and compares candidates on their own merits.
  if (
    comparisonConfig.hasGoldenAnswer !== false &&
    comparisonConfig.goldenField
  ) {
    inputs.golden = cell.datasetEntry[comparisonConfig.goldenField];
  }

  assignComparisonCandidateInputs({
    inputs,
    evaluator,
    comparison: cell.comparison!,
    rowIndex: cell.rowIndex,
  });

  applyComparisonMappingFallback({
    inputs,
    evaluator,
    datasetId,
    targetId: cell.targetId,
  });

  return inputs;
};

type MappedInputResolution =
  | { assign: false }
  | { assign: true; value: unknown };

/**
 * Resolves one evaluator input field's mapping to the value it should carry —
 * or `{ assign: false }` when the mapping doesn't apply (e.g. a "target"
 * source pointing at a different target than this cell's), leaving the field
 * unset rather than set to `undefined`.
 */
const resolveMappedInputValue = ({
  mapping,
  targetId,
  datasetEntry,
  targetOutput,
}: {
  mapping: FieldMapping;
  targetId: string;
  datasetEntry: Record<string, unknown>;
  targetOutput: Record<string, unknown>;
}): MappedInputResolution => {
  if (mapping.type === "value") {
    return { assign: true, value: mapping.value };
  }
  if (mapping.type === "source") {
    if (mapping.source === "dataset") {
      // From dataset entry - uses column name as key
      return { assign: true, value: datasetEntry[mapping.sourceField] };
    }
    if (mapping.source === "target" && mapping.sourceId === targetId) {
      // From target output
      return { assign: true, value: targetOutput[mapping.sourceField] };
    }
  }
  return { assign: false };
};

/** Builds evaluator inputs by walking its configured field mappings for this dataset + target. */
const buildMappedEvaluatorInputs = ({
  cell,
  evaluator,
  targetOutput,
  datasetId,
}: {
  cell: ExecutionCell;
  evaluator: EvaluatorConfig;
  targetOutput: Record<string, unknown>;
  datasetId: string;
}): Record<string, unknown> => {
  const inputs: Record<string, unknown> = {};
  const mappings = evaluator.mappings[datasetId]?.[cell.targetId] ?? {};

  for (const [inputField, mapping] of Object.entries(mappings)) {
    const resolved = resolveMappedInputValue({
      mapping,
      targetId: cell.targetId,
      datasetEntry: cell.datasetEntry,
      targetOutput,
    });
    if (resolved.assign) inputs[inputField] = resolved.value;
  }

  return inputs;
};

/**
 * Exported (in addition to being used internally by executeCell) so it can be
 * unit-tested directly: it is the one place that assembles the actual
 * per-evaluator dispatch payload at runtime, and the comparison branch is
 * where #5528's legacy-pairwise/N-way payload-shape bug lives. See the
 * `evaluator.evaluatorType === LEGACY_PAIRWISE_EVALUATOR_TYPE` branch below.
 */
export const buildEvaluatorInputs = (
  cell: ExecutionCell,
  evaluatorId: string,
  targetOutput: Record<string, unknown>,
): Record<string, unknown> => {
  const datasetId = cell.datasetEntry._datasetId as string | undefined;
  if (!datasetId) return {};

  // Find the evaluator config
  const evaluator = cell.evaluatorConfigs.find((e) => e.id === evaluatorId);
  if (!evaluator) return {};

  const comparisonConfig = toComparisonConfig(evaluator);
  if (comparisonConfig && cell.comparison) {
    return buildComparisonEvaluatorInputs({
      cell,
      evaluator,
      comparisonConfig,
      datasetId,
    });
  }

  return buildMappedEvaluatorInputs({
    cell,
    evaluator,
    targetOutput,
    datasetId,
  });
};

/**
 * Builds the input values for a target from the cell's dataset entry.
 *
 * Note: Dataset entries are normalized to use column NAMES as keys at the API boundary,
 * so we can use mapping.sourceField directly without ID-to-name translation.
 */
const buildTargetInputs = (cell: ExecutionCell): Record<string, unknown> => {
  const inputs: Record<string, unknown> = {};
  const datasetId = cell.datasetEntry._datasetId as string | undefined;
  if (!datasetId) return inputs;

  const mappings = cell.targetConfig.mappings[datasetId] ?? {};

  for (const [inputField, mapping] of Object.entries(mappings)) {
    if (mapping.type === "source" && mapping.source === "dataset") {
      // Dataset entries use column name as key
      inputs[inputField] = cell.datasetEntry[mapping.sourceField];
    } else if (mapping.type === "value") {
      inputs[inputField] = mapping.value;
    }
  }

  return inputs;
};

/**
 * Build the per-target metadata stored with a run (startExperimentRun's
 * `targets` payload).
 *
 * Model attribution: `localPromptConfig.llm.model` wins (edited prompts),
 * falling back to the loaded prompt's model for saved prompts. Name comes
 * from the loaded entity (prompt, agent, evaluator, or workflow), falling
 * back to the target id. Exported for unit testing — a regression here
 * blanks the model column on every stored run.
 */
/**
 * Model attribution: `localPromptConfig.llm.model` wins (edited prompts),
 * falling back to the loaded prompt's model for saved prompts, then the
 * evaluator judge's own model when the target is an evaluator.
 */
const resolveTargetMetadataModel = ({
  target,
  loadedPrompts,
  loadedEvaluators,
}: {
  target: TargetConfig;
  loadedPrompts: Map<string, VersionedPrompt>;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
}): string | null => {
  // First check local prompt config (for edited prompts)
  if (target.localPromptConfig?.llm?.model) {
    return target.localPromptConfig.llm.model;
  }

  // Otherwise, check loaded prompts (for saved prompts)
  if (target.type === "prompt" && target.promptId) {
    return loadedPrompts.get(target.promptId)?.model ?? null;
  }

  // Evaluator targets — the judge. Recorded onto the run for the same
  // reason a prompt target's model is: the evaluator's config can be
  // edited afterwards, and reading it live would retroactively
  // misattribute every historical run to whatever model is configured
  // today. The leaderboard's self-preference check depends on knowing
  // which model actually judged, so a wrong answer here is worse than
  // none.
  if (target.type === "evaluator" && target.targetEvaluatorId) {
    // Unsaved edits first, exactly as the prompt branch above does and as
    // `workflowBuilder` does when it decides what to actually RUN. Reading
    // only the saved config meant a user who switched the judge model
    // without saving ran on one model and recorded the other — and the
    // recorded one is what feeds the leaderboard's self-preference check,
    // so it would report independence from a model that never judged.
    const settings =
      (
        target.localEvaluatorConfig as
          | { settings?: { model?: unknown } }
          | undefined
      )?.settings ??
      (
        loadedEvaluators?.get(target.targetEvaluatorId)?.config as
          | { settings?: { model?: unknown } }
          | undefined
      )?.settings;
    return typeof settings?.model === "string" && settings.model
      ? settings.model
      : null;
  }

  return null;
};

const nameFromLoadedPrompt = ({
  target,
  loadedPrompts,
}: {
  target: TargetConfig;
  loadedPrompts: Map<string, VersionedPrompt>;
}): string | null =>
  target.promptId ? (loadedPrompts.get(target.promptId)?.name ?? null) : null;

const nameFromLoadedAgent = ({
  target,
  loadedAgents,
}: {
  target: TargetConfig;
  loadedAgents: Map<string, TypedAgent>;
}): string | null =>
  target.dbAgentId ? (loadedAgents.get(target.dbAgentId)?.name ?? null) : null;

const nameFromLoadedEvaluator = ({
  target,
  loadedEvaluators,
}: {
  target: TargetConfig;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
}): string | null =>
  target.targetEvaluatorId
    ? (loadedEvaluators?.get(target.targetEvaluatorId)?.name ?? null)
    : null;

const nameFromLoadedWorkflow = ({
  target,
  loadedWorkflows,
}: {
  target: TargetConfig;
  loadedWorkflows?: Map<string, LoadedWorkflow>;
}): string | null =>
  target.workflowId
    ? (loadedWorkflows?.get(workflowLoadKey(target))?.name ?? null)
    : null;

/** Name comes from the loaded entity (prompt, agent, evaluator, or workflow), falling back to the target id. */
const resolveTargetMetadataName = ({
  target,
  loadedPrompts,
  loadedAgents,
  loadedEvaluators,
  loadedWorkflows,
}: {
  target: TargetConfig;
  loadedPrompts: Map<string, VersionedPrompt>;
  loadedAgents: Map<string, TypedAgent>;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  loadedWorkflows?: Map<string, LoadedWorkflow>;
}): string | null => {
  if (target.type === "prompt")
    return nameFromLoadedPrompt({ target, loadedPrompts });
  if (target.type === "agent")
    return nameFromLoadedAgent({ target, loadedAgents });
  if (target.type === "evaluator")
    return nameFromLoadedEvaluator({ target, loadedEvaluators });
  if (target.type === "workflow")
    return nameFromLoadedWorkflow({ target, loadedWorkflows });
  return null;
};

const buildOneTargetMetadata = ({
  target,
  loadedPrompts,
  loadedAgents,
  loadedEvaluators,
  loadedWorkflows,
}: {
  target: TargetConfig;
  loadedPrompts: Map<string, VersionedPrompt>;
  loadedAgents: Map<string, TypedAgent>;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  loadedWorkflows?: Map<string, LoadedWorkflow>;
}): ESBatchEvaluationTarget => {
  const model = resolveTargetMetadataModel({
    target,
    loadedPrompts,
    loadedEvaluators,
  });
  const name = resolveTargetMetadataName({
    target,
    loadedPrompts,
    loadedAgents,
    loadedEvaluators,
    loadedWorkflows,
  });

  return {
    id: target.id,
    name: name ?? target.id,
    type: target.type,
    prompt_id: target.promptId ?? null,
    prompt_version: target.promptVersionNumber ?? null,
    agent_id: target.dbAgentId ?? null,
    evaluator_id: target.targetEvaluatorId ?? null,
    model,
  };
};

export const buildTargetMetadata = ({
  targets,
  loadedPrompts,
  loadedAgents,
  loadedEvaluators,
  loadedWorkflows,
}: {
  targets: EvaluationsV3State["targets"];
  loadedPrompts: Map<string, VersionedPrompt>;
  loadedAgents: Map<string, TypedAgent>;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  loadedWorkflows?: Map<string, LoadedWorkflow>;
}): ESBatchEvaluationTarget[] =>
  targets.map((target) =>
    buildOneTargetMetadata({
      target,
      loadedPrompts,
      loadedAgents,
      loadedEvaluators,
      loadedWorkflows,
    }),
  );

const buildDispatchFromTargetResultEvent = ({
  tenantId,
  runId,
  experimentId,
  event,
  datasetEntry,
  occurredAt,
}: {
  tenantId: string;
  runId: string;
  experimentId: string;
  event: Extract<EvaluationV3Event, { type: "target_result" }>;
  datasetEntry: Record<string, unknown>;
  occurredAt: number;
}): RecordTargetResultCommandData => ({
  tenantId,
  runId,
  experimentId,
  index: event.rowIndex,
  targetId: event.targetId,
  entry: datasetEntry,
  predicted:
    event.output === null || event.output === undefined
      ? null
      : { output: event.output },
  cost: event.cost ?? null,
  duration: event.duration ?? null,
  error: event.error ?? null,
  domainError: event.domainError ?? null,
  traceId: event.traceId ?? null,
  occurredAt,
});

const buildDispatchFromErrorEvent = ({
  tenantId,
  runId,
  experimentId,
  event,
  datasetEntry,
  occurredAt,
}: {
  tenantId: string;
  runId: string;
  experimentId: string;
  event: Extract<EvaluationV3Event, { type: "error" }> & {
    rowIndex: number;
    targetId: string;
  };
  datasetEntry: Record<string, unknown>;
  occurredAt: number;
}): RecordTargetResultCommandData => ({
  tenantId,
  runId,
  experimentId,
  index: event.rowIndex,
  targetId: event.targetId,
  entry: datasetEntry,
  predicted: null,
  cost: null,
  duration: null,
  // The wire message: a handled failure's code, or the unnamed-failure
  // marker. Both are safe to read back; the thrown error's own words are
  // not, and are logged instead.
  error: event.message,
  domainError: event.domainError ?? null,
  traceId: event.traceId ?? null,
  occurredAt,
});

/**
 * Build the recordTargetResult dispatch payload for a `target_result` or
 * cell-level `error` event. Returns null for events that don't record a
 * target result.
 *
 * Exported for unit testing — two regression-prone behaviours live here:
 * falsy target outputs (`false`, `0`, `""`) must persist as
 * `{ output: value }` (only null/undefined become a null `predicted`), and
 * error events must land as predicted-null rows carrying the error message.
 *
 * The row stores the failure's CODE (`domainError`) as well as its string.
 * This row is what the grid renders after a reload, so a row holding only the
 * engine's raw text (`httpblock: Post "…": no such host`) meant the customer
 * read registry copy live and raw Go on refresh — the leak this event's
 * `domainError` closes only for as long as the tab stays open.
 *
 * A thrown failure's own message is NOT stored. Nothing about it is
 * customer-safe, and this column is customer-visible; it belongs on the log
 * line at the catch site, next to the trace id this row also carries.
 */
export const buildTargetResultDispatch = ({
  tenantId,
  runId,
  experimentId,
  event,
  datasetEntry,
  occurredAt,
}: {
  tenantId: string;
  runId: string;
  experimentId: string;
  event: EvaluationV3Event;
  datasetEntry: Record<string, unknown>;
  occurredAt: number;
}): RecordTargetResultCommandData | null => {
  if (event.type === "target_result") {
    return buildDispatchFromTargetResultEvent({
      tenantId,
      runId,
      experimentId,
      event,
      datasetEntry,
      occurredAt,
    });
  }

  if (
    event.type === "error" &&
    event.rowIndex !== undefined &&
    event.targetId
  ) {
    return buildDispatchFromErrorEvent({
      tenantId,
      runId,
      experimentId,
      event: event as Extract<EvaluationV3Event, { type: "error" }> & {
        rowIndex: number;
        targetId: string;
      },
      datasetEntry,
      occurredAt,
    });
  }

  return null;
};

type ChDispatchStats = { total: number; failures: number };

/** Tracks traceId from target_result so evaluator_result events can reference it. */
const trackCellTraceId = ({
  event,
  cellTraceIds,
}: {
  event: EvaluationV3Event;
  cellTraceIds: Map<string, string>;
}): void => {
  if (event.type === "target_result" && event.traceId) {
    cellTraceIds.set(`${event.rowIndex}:${event.targetId}`, event.traceId);
  }
};

/** Captures successful target outputs for Phase 2 pairwise cells. */
const captureCompletedTargetOutput = ({
  event,
  completedTargetOutputs,
  producedTargetKeys,
}: {
  event: EvaluationV3Event;
  completedTargetOutputs: Map<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
  producedTargetKeys: Set<string>;
}): void => {
  if (
    event.type === "target_result" &&
    !event.error &&
    event.output !== null &&
    event.output !== undefined
  ) {
    completedTargetOutputs.set(`${event.rowIndex}:${event.targetId}`, {
      output: event.output,
      cost: event.cost ?? undefined,
      duration: event.duration ?? undefined,
    });
    producedTargetKeys.add(`${event.rowIndex}:${event.targetId}`);
  }
};

/**
 * Caches per-(row, target) evaluator scores so the Phase 2 comparison
 * judge can see what each variant already scored on its per-row
 * evaluators. Skip comparison evaluators themselves — a comparison judge
 * reading another comparison's verdict is circular.
 */
const cacheEvaluatorScoreForComparison = ({
  event,
  evalResult,
  evaluatorConfig,
  loadedEvaluators,
  completedTargetEvaluatorScores,
}: {
  event: Extract<EvaluationV3Event, { type: "evaluator_result" }>;
  evalResult: SingleEvaluationResult;
  evaluatorConfig: EvaluatorConfig | undefined;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  completedTargetEvaluatorScores: Map<
    string,
    Array<{ name: string; score?: number; label?: string; passed?: boolean }>
  >;
}): void => {
  if (
    evalResult.status !== "processed" ||
    !evaluatorConfig ||
    isComparisonEvaluator(evaluatorConfig)
  ) {
    return;
  }

  const dbEval = evaluatorConfig.dbEvaluatorId
    ? loadedEvaluators?.get(evaluatorConfig.dbEvaluatorId)
    : null;
  const name =
    dbEval?.name ??
    evaluatorConfig.evaluatorType?.split("/").pop() ??
    evaluatorConfig.id;
  const key = `${event.rowIndex}:${event.targetId}`;
  const arr = completedTargetEvaluatorScores.get(key) ?? [];
  arr.push({
    name,
    score: evalResult.score ?? undefined,
    label: evalResult.label ?? undefined,
    passed: evalResult.passed ?? undefined,
  });
  completedTargetEvaluatorScores.set(key, arr);
};

/** Dispatches to the evaluation processing pipeline for per-trace eval CH writes. */
const reportEvaluationToPipeline = async ({
  event,
  evalResult,
  evaluatorConfig,
  loadedEvaluators,
  projectId,
  cellTraceIds,
}: {
  event: Extract<EvaluationV3Event, { type: "evaluator_result" }>;
  evalResult: SingleEvaluationResult;
  evaluatorConfig: EvaluatorConfig | undefined;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  projectId: string;
  cellTraceIds: Map<string, string>;
}): Promise<void> => {
  const dbEvaluator = evaluatorConfig?.dbEvaluatorId
    ? loadedEvaluators?.get(evaluatorConfig.dbEvaluatorId)
    : null;
  const traceId = cellTraceIds.get(`${event.rowIndex}:${event.targetId}`);
  const evaluationId = generate(KSUID_RESOURCES.EVALUATION).toString();
  const processed = evalResult.status === "processed" ? evalResult : undefined;
  try {
    const app = getApp();
    await app.evaluations.reportEvaluation({
      tenantId: projectId,
      evaluationId,
      evaluatorId: event.evaluatorId,
      evaluatorType: evaluatorConfig?.evaluatorType ?? "unknown",
      evaluatorName: dbEvaluator?.name,
      traceId,
      status: evalResult.status,
      score: processed?.score ?? undefined,
      passed: processed?.passed ?? undefined,
      // For pairwise verdicts, langevals now returns the winner's
      // candidate id (or "tie") directly in `label`. No translation
      // needed here; SDK / REST / MCP consumers see the winner by id.
      label: processed?.label ?? undefined,
      details: processed?.details ?? undefined,
      error: evalResult.status === "error" ? evalResult.details : undefined,
      occurredAt: Date.now(),
    });
  } catch (error) {
    logger.error(
      { error, evaluationId, evaluatorId: event.evaluatorId },
      "Failed to dispatch evaluator result to evaluation processing pipeline",
    );
  }
};

/** Handles an `evaluator_result` event: cache its score, then report it to the evaluation pipeline. */
const processEvaluatorResultEvent = async ({
  event,
  state,
  loadedEvaluators,
  projectId,
  cellTraceIds,
  completedTargetEvaluatorScores,
}: {
  event: Extract<EvaluationV3Event, { type: "evaluator_result" }>;
  state: EvaluationsV3State;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  projectId: string;
  cellTraceIds: Map<string, string>;
  completedTargetEvaluatorScores: Map<
    string,
    Array<{ name: string; score?: number; label?: string; passed?: boolean }>
  >;
}): Promise<void> => {
  const evalResult = event.result as SingleEvaluationResult;
  const evaluatorConfig = state.evaluators.find(
    (e) => e.id === event.evaluatorId,
  );

  cacheEvaluatorScoreForComparison({
    event,
    evalResult,
    evaluatorConfig,
    loadedEvaluators,
    completedTargetEvaluatorScores,
  });

  await reportEvaluationToPipeline({
    event,
    evalResult,
    evaluatorConfig,
    loadedEvaluators,
    projectId,
    cellTraceIds,
  });
};

/** Dispatches a target_result/error event's row to ClickHouse via recordTargetResult. Returns whether it dispatched. */
const dispatchTargetResultToCH = async ({
  event,
  projectId,
  runId,
  experimentId,
  datasetRows,
  commands,
  chDispatchStats,
}: {
  event: EvaluationV3Event;
  projectId: string;
  runId: string;
  experimentId: string;
  datasetRows: Array<Record<string, unknown>>;
  commands: ReturnType<typeof getApp>["experimentRuns"];
  chDispatchStats: ChDispatchStats;
}): Promise<boolean> => {
  const targetResultDispatch =
    event.type === "target_result" || event.type === "error"
      ? buildTargetResultDispatch({
          tenantId: projectId,
          runId,
          experimentId,
          event,
          datasetEntry:
            event.rowIndex !== undefined
              ? (datasetRows[event.rowIndex] ?? {})
              : {},
          occurredAt: Date.now(),
        })
      : null;

  if (!targetResultDispatch) return false;

  chDispatchStats.total++;
  await commands.recordTargetResult(targetResultDispatch).catch((err) => {
    chDispatchStats.failures++;
    logger.warn({ err, runId }, "Failed to dispatch recordTargetResult to CH");
  });
  return true;
};

const resolveEvaluatorResultDetails = (
  result: SingleEvaluationResult,
): string | null | undefined =>
  result.status === "error"
    ? result.details
    : result.status === "processed"
      ? result.details
      : null;

/** Dispatches an evaluator_result event to ClickHouse via recordEvaluatorResult. */
const buildRecordEvaluatorResultPayload = ({
  event,
  projectId,
  runId,
  experimentId,
  result,
  dbEvaluator,
}: {
  event: Extract<EvaluationV3Event, { type: "evaluator_result" }>;
  projectId: string;
  runId: string;
  experimentId: string;
  result: SingleEvaluationResult;
  dbEvaluator: { id: string; name: string; config: unknown } | null | undefined;
}): RecordEvaluatorResultCommandData => {
  const processed = result.status === "processed" ? result : undefined;
  return {
    tenantId: projectId,
    runId,
    experimentId,
    index: event.rowIndex,
    targetId: event.targetId,
    evaluatorId: event.evaluatorId,
    // Workflow evaluator nodes have no DB record, so fall back to the
    // name the event carries from the DSL node.
    evaluatorName: dbEvaluator?.name ?? event.evaluatorName ?? null,
    status: result.status,
    score: processed ? processed.score : null,
    label: processed ? processed.label : null,
    passed: processed ? processed.passed : null,
    details: resolveEvaluatorResultDetails(result),
    occurredAt: Date.now(),
    cost: processed?.cost ? processed.cost.amount : null,
    duration: event.duration ?? null,
    inputs: event.inputs ?? null,
  };
};

const dispatchEvaluatorResultToCH = async ({
  event,
  projectId,
  runId,
  experimentId,
  state,
  loadedEvaluators,
  commands,
  chDispatchStats,
}: {
  event: Extract<EvaluationV3Event, { type: "evaluator_result" }>;
  projectId: string;
  runId: string;
  experimentId: string;
  state: EvaluationsV3State;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  commands: ReturnType<typeof getApp>["experimentRuns"];
  chDispatchStats: ChDispatchStats;
}): Promise<void> => {
  const result = event.result as SingleEvaluationResult;
  const evaluatorConfig = state.evaluators.find(
    (e) => e.id === event.evaluatorId,
  );
  const dbEvaluator = evaluatorConfig?.dbEvaluatorId
    ? loadedEvaluators?.get(evaluatorConfig.dbEvaluatorId)
    : null;

  chDispatchStats.total++;
  await commands
    .recordEvaluatorResult(
      buildRecordEvaluatorResultPayload({
        event,
        projectId,
        runId,
        experimentId,
        result,
        dbEvaluator,
      }),
    )
    .catch((err) => {
      chDispatchStats.failures++;
      logger.warn(
        { err, runId },
        "Failed to dispatch recordEvaluatorResult to CH",
      );
    });
};

/** Dispatches a mapped event to ClickHouse: recordTargetResult, or recordEvaluatorResult as fallback. */
const dispatchEventToClickHouse = async ({
  event,
  projectId,
  runId,
  experimentId,
  datasetRows,
  state,
  loadedEvaluators,
  commands,
  chDispatchStats,
}: {
  event: EvaluationV3Event;
  projectId: string;
  runId: string;
  experimentId: string | undefined;
  datasetRows: Array<Record<string, unknown>>;
  state: EvaluationsV3State;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  commands: ReturnType<typeof getApp>["experimentRuns"];
  chDispatchStats: ChDispatchStats;
}): Promise<void> => {
  if (!experimentId) return;

  const dispatchedAsTargetResult = await dispatchTargetResultToCH({
    event,
    projectId,
    runId,
    experimentId,
    datasetRows,
    commands,
    chDispatchStats,
  });

  if (!dispatchedAsTargetResult && event.type === "evaluator_result") {
    await dispatchEvaluatorResultToCH({
      event,
      projectId,
      runId,
      experimentId,
      state,
      loadedEvaluators,
      commands,
      chDispatchStats,
    });
  }
};

type OrchestratorProgressState = {
  totalCells: number;
  totalCost: number;
  failedCells: number;
  completedCells: number;
  completed: number;
  aborted: boolean;
};

type EventChannel = {
  pushEvent: (event: EvaluationV3Event) => void;
  signalComplete: () => void;
  waitForEvent: () => Promise<EvaluationV3Event | null>;
};

/**
 * Event queue for collecting results from parallel cell executions.
 * Uses a resolver pattern to allow yielding events as they arrive.
 */
const createEventChannel = (): EventChannel => {
  type EventResolver = (event: EvaluationV3Event | null) => void;
  let eventResolve: EventResolver | null = null;
  const eventQueue: EvaluationV3Event[] = [];
  let allCellsComplete = false;

  const pushEvent = (event: EvaluationV3Event) => {
    if (eventResolve) {
      const resolve = eventResolve;
      eventResolve = null;
      resolve(event);
    } else {
      eventQueue.push(event);
    }
  };

  const signalComplete = () => {
    allCellsComplete = true;
    if (eventResolve) {
      const resolve = eventResolve;
      eventResolve = null;
      resolve(null);
    }
  };

  const waitForEvent = (): Promise<EvaluationV3Event | null> => {
    // Check queue first
    if (eventQueue.length > 0) {
      return Promise.resolve(eventQueue.shift()!);
    }
    // If all cells complete and queue empty, we're done
    if (allCellsComplete) {
      return Promise.resolve(null);
    }
    // Wait for next event
    return new Promise<EvaluationV3Event | null>((resolve) => {
      eventResolve = resolve;
    });
  };

  return { pushEvent, signalComplete, waitForEvent };
};

type OrchestratorRunContext = {
  runId: string;
  projectId: string;
  scope: ExecutionScope;
  state: EvaluationsV3State;
  datasetRows: Array<Record<string, unknown>>;
  datasetColumns: Array<{ id: string; name: string; type: string }>;
  loadedPrompts: Map<string, VersionedPrompt>;
  loadedAgents: Map<string, TypedAgent>;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  loadedWorkflows?: Map<string, LoadedWorkflow>;
  resultMapperConfig: ResultMapperConfig;
  seedTargetOutputs?: Record<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
  completedTargetOutputs: Map<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
  completedTargetEvaluatorScores: Map<
    string,
    Array<{ name: string; score?: number; label?: string; passed?: boolean }>
  >;
  producedTargetKeys: Set<string>;
  pushEvent: (event: EvaluationV3Event) => void;
  processEventForStorage: (event: EvaluationV3Event) => Promise<void>;
  semaphore: ReturnType<typeof createSemaphore>;
  activeCells: Set<Promise<void>>;
  progress: OrchestratorProgressState;
};

/**
 * Picks the executor for a Phase-1 cell: a workflow target — or an agent
 * target that wraps a Studio workflow (agent.type === "workflow") — runs
 * the full studio workflow once per row via execute_flow; every other
 * target runs a single component. Both yield the same target_result /
 * evaluator_result events.
 */
const resolvePhase1CellEvents = ({
  cell,
  ctx,
}: {
  cell: ExecutionCell;
  ctx: OrchestratorRunContext;
}): AsyncGenerator<EvaluationV3Event> => {
  // Get loaded data for this target
  const loadedData = {
    ...getLoadedDataForTarget({
      targetConfig: cell.targetConfig,
      loadedPrompts: ctx.loadedPrompts,
      loadedAgents: ctx.loadedAgents,
      loadedWorkflows: ctx.loadedWorkflows,
    }),
    evaluators: ctx.loadedEvaluators,
  };

  // Create abort checker bound to this run
  const checkAbort = () => abortManager.isAborted(ctx.runId);

  const runsAsWorkflow =
    (cell.targetConfig.type === "workflow" ||
      (cell.targetConfig.type === "agent" &&
        loadedData.agent?.type === "workflow")) &&
    !!loadedData.workflow;

  return runsAsWorkflow
    ? executeWorkflowCell({
        cell,
        projectId: ctx.projectId,
        workflowDsl: loadedData.workflow!.dsl,
        isAborted: checkAbort,
      })
    : executeCell({
        cell,
        projectId: ctx.projectId,
        datasetColumns: ctx.datasetColumns,
        loadedData,
        resultMapperConfig: ctx.resultMapperConfig,
        isAborted: checkAbort,
      });
};

type Phase1CellOutcome = { cellFailed: boolean; cellAborted: boolean };

/** Streams a Phase-1 cell's events to the SSE channel and storage, tracking cost + failure. */
const consumePhase1CellEvents = async ({
  cellEvents,
  ctx,
}: {
  cellEvents: AsyncGenerator<EvaluationV3Event>;
  ctx: OrchestratorRunContext;
}): Promise<Phase1CellOutcome> => {
  let cellFailed = false;
  let cellAborted = false;
  for await (const event of cellEvents) {
    // Check abort during cell processing
    if (await abortManager.isAborted(ctx.runId)) {
      cellAborted = true;
      break;
    }

    ctx.pushEvent(event);

    // Process for storage
    await ctx.processEventForStorage(event);

    // Track failures
    if (
      event.type === "error" ||
      (event.type === "target_result" && event.error)
    ) {
      cellFailed = true;
    }

    // Track costs
    if (event.type === "target_result" && event.cost) {
      ctx.progress.totalCost += event.cost;
    }
  }
  return { cellFailed, cellAborted };
};

/** Records a Phase-1 cell's completion: abort propagation, counters, and the progress event. */
const recordPhase1CellCompletion = async ({
  outcome,
  ctx,
}: {
  outcome: Phase1CellOutcome;
  ctx: OrchestratorRunContext;
}): Promise<void> => {
  // If aborted mid-cell, signal abort at the orchestrator level
  if (outcome.cellAborted) {
    ctx.progress.aborted = true;
  }

  ctx.progress.completed++;
  if (outcome.cellFailed) {
    ctx.progress.failedCells++;
  } else {
    ctx.progress.completedCells++;
  }

  // Add progress event
  const progressEvent: EvaluationV3Event = {
    type: "progress",
    completed: ctx.progress.completed,
    total: ctx.progress.totalCells,
  };
  ctx.pushEvent(progressEvent);
  await ctx.processEventForStorage(progressEvent);
};

/** Executes one Phase-1 (per-target) cell: runs it, streams + stores its events, and records progress. */
const runPhase1Cell = async ({
  cell,
  ctx,
}: {
  cell: ExecutionCell;
  ctx: OrchestratorRunContext;
}): Promise<void> => {
  // Double-check abort flag after acquiring semaphore
  if (await abortManager.isAborted(ctx.runId)) {
    return;
  }

  const cellEvents = resolvePhase1CellEvents({ cell, ctx });
  const outcome = await consumePhase1CellEvents({ cellEvents, ctx });
  await recordPhase1CellCompletion({ outcome, ctx });
};

/** Processes Phase-1 cells in parallel with rate limiting, then waits for all to finish. */
const runPhase1Cells = async ({
  cells,
  ctx,
}: {
  cells: ExecutionCell[];
  ctx: OrchestratorRunContext;
}): Promise<void> => {
  for (const cell of cells) {
    // Check abort flag before starting new cells
    if (await abortManager.isAborted(ctx.runId)) {
      logger.info({ runId: ctx.runId }, "Execution aborted by user");
      ctx.progress.aborted = true;
      break;
    }

    // Wait for semaphore slot
    await ctx.semaphore.acquire();

    // Start cell execution
    const cellPromise = runPhase1Cell({ cell, ctx }).finally(() => {
      ctx.semaphore.release();
    });

    ctx.activeCells.add(cellPromise);
    // Don't await here - let cells run in parallel
    // Clean up when cell completes
    void cellPromise.finally(() => ctx.activeCells.delete(cellPromise));
  }

  // Wait for all Phase 1 cells to complete
  await Promise.all(ctx.activeCells);
};

/** Executes one Phase-2 (comparison) cell via executeCell, streams + stores its events, and records progress. */
const runPhase2Cell = async ({
  cell,
  ctx,
}: {
  cell: ExecutionCell;
  ctx: OrchestratorRunContext;
}): Promise<void> => {
  if (await abortManager.isAborted(ctx.runId)) return;

  const loadedData = {
    ...getLoadedDataForTarget({
      targetConfig: cell.targetConfig,
      loadedPrompts: ctx.loadedPrompts,
      loadedAgents: ctx.loadedAgents,
    }),
    evaluators: ctx.loadedEvaluators,
  };

  const checkAbort = () => abortManager.isAborted(ctx.runId);

  let cellFailed = false;
  for await (const event of executeCell({
    cell,
    projectId: ctx.projectId,
    datasetColumns: ctx.datasetColumns,
    loadedData,
    resultMapperConfig: ctx.resultMapperConfig,
    isAborted: checkAbort,
  })) {
    if (await abortManager.isAborted(ctx.runId)) break;
    ctx.pushEvent(event);
    await ctx.processEventForStorage(event);
    if (event.type === "error") cellFailed = true;
  }

  ctx.progress.completed++;
  if (cellFailed) ctx.progress.failedCells++;
  else ctx.progress.completedCells++;

  ctx.pushEvent({
    type: "progress",
    completed: ctx.progress.completed,
    total: ctx.progress.totalCells,
  });
};

/** Processes Phase-2 (comparison) cells in parallel with rate limiting, then waits for all to finish. */
const runPhase2Cells = async ({
  cells,
  ctx,
}: {
  cells: ExecutionCell[];
  ctx: OrchestratorRunContext;
}): Promise<void> => {
  for (const cell of cells) {
    if (await abortManager.isAborted(ctx.runId)) {
      ctx.progress.aborted = true;
      break;
    }
    await ctx.semaphore.acquire();

    const cellPromise = runPhase2Cell({ cell, ctx }).finally(() => {
      ctx.semaphore.release();
    });

    ctx.activeCells.add(cellPromise);
    void cellPromise.finally(() => ctx.activeCells.delete(cellPromise));
  }

  await Promise.all(ctx.activeCells);
};

/** Maps a comparison skip reason to its user-facing detail + error type. */
const describeComparisonSkip = (
  reason: ComparisonSkipReason,
): { detail: string; errorType: string } => {
  const which = formatList(reason.variantNames);
  if (reason.kind === "missing-output") {
    return {
      detail: `Waiting on ${which} — no ${
        reason.variantNames.length > 1 ? "outputs" : "output"
      } for this row yet. Run ${which} first, then re-run this comparison.`,
      errorType: "MissingVariantOutput",
    };
  }
  // Re-running won't help — the output is empty or the picked
  // field is gone. Point the user at the output-field config.
  return {
    detail: `${which} produced no text to compare for this row. Check the output field selected for ${which}.`,
    errorType: "EmptyVariantOutput",
  };
};

/**
 * Emits a synthetic evaluator_result error event for each row we had
 * to skip. Without this the comparison column would sit at "No verdict
 * yet" indefinitely with no indication of what the real problem is.
 *
 * pushEvent feeds the SSE stream so the UI cell re-renders into the
 * friendlyError surface immediately; processEventForStorage also
 * writes it to ClickHouse for the historical record.
 */
const emitComparisonSkipReasons = async ({
  skipReasons,
  ctx,
}: {
  skipReasons: ComparisonSkipReason[];
  ctx: OrchestratorRunContext;
}): Promise<void> => {
  for (const reason of skipReasons) {
    // Respect user-triggered abort mid-loop; otherwise a long skip-reason
    // burst would keep writing to CH after the run was meant to stop.
    if (await abortManager.isAborted(ctx.runId)) {
      ctx.progress.aborted = true;
      break;
    }
    const { detail, errorType } = describeComparisonSkip(reason);
    const skipEvent: EvaluationV3Event = {
      type: "evaluator_result",
      rowIndex: reason.rowIndex,
      targetId: reason.targetId,
      evaluatorId: reason.evaluatorId,
      result: {
        status: "error",
        details: detail,
        error_type: errorType,
      } as unknown as SingleEvaluationResult,
    };
    ctx.pushEvent(skipEvent);
    await ctx.processEventForStorage(skipEvent);
  }
};

/**
 * Back-fills the candidate outputs this run REUSED rather than executed.
 *
 * Since #5789 fix 2, a comparison re-run deliberately does NOT re-run
 * variants whose output the client already has — it seeds them instead.
 * The upshot is that such a run stores only the judge's verdict: no
 * predicted output, no dataset entry, because no target cell ran. The
 * Results view builds its rows from target results, so a
 * comparison-only run rendered "No results to display" with $0 cost,
 * even though the judge had compared everything. Re-record what was
 * actually compared so a run's stored result stands on its own.
 *
 * The seeded cost/duration are carried over rather than nulled. They
 * describe the output being compared, and the results table keys its
 * per-target header metrics off them — omitting them left every prompt
 * header on the Results page blank, which is how this surfaced. The
 * trade-off is that a run's cost total includes outputs it reused
 * rather than paid for, so summing cost ACROSS runs over-counts real
 * spend; describing the run's own results wins over that here, and it
 * matches what the workbench shows for the same cells.
 */
/** Parses a `${rowIndex}:${targetId}` seed key, or undefined when malformed. */
const parseSeededTargetKey = (
  key: string,
): { rowIndex: number; targetId: string } | undefined => {
  const separator = key.indexOf(":");
  if (separator < 0) return undefined;
  const rowIndex = Number(key.slice(0, separator));
  if (!Number.isInteger(rowIndex)) return undefined;
  return { rowIndex, targetId: key.slice(separator + 1) };
};

/** Whether a seeded output should be backfilled: not already produced, in-scope row, still a real row, non-empty. */
const shouldBackfillSeededOutput = ({
  key,
  rowIndex,
  seeded,
  ctx,
  rowsThisRunOwns,
}: {
  key: string;
  rowIndex: number;
  seeded: { output: unknown; cost?: number; duration?: number };
  ctx: OrchestratorRunContext;
  rowsThisRunOwns: Set<number>;
}): boolean =>
  !ctx.producedTargetKeys.has(key) &&
  rowsThisRunOwns.has(rowIndex) &&
  !!ctx.datasetRows[rowIndex] &&
  seeded.output !== null &&
  seeded.output !== undefined;

const backfillSeededTargetOutputs = async ({
  ctx,
}: {
  ctx: OrchestratorRunContext;
}): Promise<void> => {
  if (!ctx.seedTargetOutputs) return;

  const rowsThisRunOwns = new Set(
    resolveScopedRowIndices({
      scope: ctx.scope,
      rowCount: ctx.datasetRows.length,
    }),
  );
  for (const [key, seeded] of Object.entries(ctx.seedTargetOutputs)) {
    const parsed = parseSeededTargetKey(key);
    if (!parsed) continue;
    const { rowIndex, targetId } = parsed;
    if (
      !shouldBackfillSeededOutput({
        key,
        rowIndex,
        seeded,
        ctx,
        rowsThisRunOwns,
      })
    ) {
      continue;
    }

    await ctx.processEventForStorage({
      type: "target_result",
      rowIndex,
      targetId,
      output: seeded.output,
      ...(seeded.cost !== undefined && { cost: seeded.cost }),
      ...(seeded.duration !== undefined && {
        duration: seeded.duration,
      }),
    } as EvaluationV3Event);
  }
};

/**
 * Phase 2: pairwise (#5100) + N-way select-best (#5101) cells.
 * Generated AFTER Phase 1 finishes because each Phase 2 cell needs
 * its variants' outputs to exist. We reuse the same semaphore +
 * executeCell loop; the new cells get appended to totalCells
 * dynamically so progress events stay honest. Pairwise and
 * select-best are generated by independent sibling functions
 * (they're two separate evaluators in the catalog) but share the
 * same execution loop, since the loop is per-cell not per-mode.
 * Phase 2 is only meaningful for a run that (re)produces variant outputs.
 *
 * An `evaluator` / `evaluator-all-rows` scope re-runs ONE evaluator over
 * outputs that already exist: its cells carry skipTarget + a precomputed
 * output and never yield a target_result, and the client seeds nothing for
 * them — so completedTargetOutputs is empty by construction. Running
 * Phase 2 anyway cannot produce a single verdict; every variant reads as
 * missing, and the only thing it emits is a "waiting on …" error written
 * over comparison verdicts the user never asked to re-run. Scoping its
 * ROWS (below) doesn't save it — for evaluator-all-rows every row is in
 * scope. The scope simply has no comparison work in it.
 */
const runComparisonPhase = async ({
  ctx,
}: {
  ctx: OrchestratorRunContext;
}): Promise<void> => {
  const scopeCanProduceVariantOutputs =
    ctx.scope.type !== "evaluator" && ctx.scope.type !== "evaluator-all-rows";

  if (ctx.progress.aborted || !scopeCanProduceVariantOutputs) return;

  const { cells: phase2Cells, skipReasons } = generateComparisonCells({
    state: ctx.state,
    datasetRows: ctx.datasetRows,
    completedTargetOutputs: ctx.completedTargetOutputs,
    completedTargetEvaluatorScores: ctx.completedTargetEvaluatorScores,
    loadedPrompts: ctx.loadedPrompts,
    loadedEvaluators: ctx.loadedEvaluators,
    // Only the rows this run owns. Without this, re-running row 1 alone
    // wrote "waiting on …" over every other row's verdict.
    scopedRowIndices: resolveScopedRowIndices({
      scope: ctx.scope,
      rowCount: ctx.datasetRows.length,
    }),
  });

  // Fold Phase-2 cells into the run total now that we know how many
  // there are, so progress and the final summary stay consistent.
  ctx.progress.totalCells += phase2Cells.length;

  await emitComparisonSkipReasons({ skipReasons, ctx });

  if (phase2Cells.length > 0) {
    await backfillSeededTargetOutputs({ ctx });

    logger.info(
      { runId: ctx.runId, comparison: phase2Cells.length },
      "Starting Phase 2 (comparison) cells",
    );

    await runPhase2Cells({ cells: phase2Cells, ctx });
  }
};

/**
 * Dispatches the run-start event to ClickHouse. A no-op when the run has no
 * `experimentId` (the interactive SSE path). Clears the running flag and
 * rethrows on failure — an experiment run that never landed its start row
 * must not be left marked running.
 */
const dispatchStartExperimentRun = async ({
  experimentId,
  projectId,
  runId,
  workflowVersionId,
  total,
  targetMetadata,
  chDispatchStats,
  commands,
}: {
  experimentId: string | undefined;
  projectId: string;
  runId: string;
  workflowVersionId: string | undefined;
  total: number;
  targetMetadata: ESBatchEvaluationTarget[];
  chDispatchStats: ChDispatchStats;
  commands: ReturnType<typeof getApp>["experimentRuns"];
}): Promise<void> => {
  if (!experimentId) return;

  chDispatchStats.total++;
  try {
    await commands.startExperimentRun({
      tenantId: projectId,
      runId,
      experimentId,
      workflowVersionId: workflowVersionId ?? null,
      total,
      targets: targetMetadata,
      occurredAt: Date.now(),
    });
  } catch (err) {
    chDispatchStats.failures++;
    logger.error({ err, runId }, "Failed to dispatch startExperimentRun to CH");
    await abortManager.clearRunning(runId);
    throw err;
  }
};

/** Builds the per-event ClickHouse-dispatch callback, closing over this run's trackers. */
const createProcessEventForStorage = ({
  projectId,
  runId,
  experimentId,
  state,
  loadedEvaluators,
  datasetRows,
  commands,
  chDispatchStats,
  cellTraceIds,
  completedTargetOutputs,
  producedTargetKeys,
  completedTargetEvaluatorScores,
}: {
  projectId: string;
  runId: string;
  experimentId: string | undefined;
  state: EvaluationsV3State;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  datasetRows: Array<Record<string, unknown>>;
  commands: ReturnType<typeof getApp>["experimentRuns"];
  chDispatchStats: ChDispatchStats;
  cellTraceIds: Map<string, string>;
  completedTargetOutputs: Map<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
  producedTargetKeys: Set<string>;
  completedTargetEvaluatorScores: Map<
    string,
    Array<{ name: string; score?: number; label?: string; passed?: boolean }>
  >;
}): ((event: EvaluationV3Event) => Promise<void>) => {
  return async (event: EvaluationV3Event) => {
    trackCellTraceId({ event, cellTraceIds });

    captureCompletedTargetOutput({
      event,
      completedTargetOutputs,
      producedTargetKeys,
    });

    if (event.type === "evaluator_result") {
      await processEvaluatorResultEvent({
        event,
        state,
        loadedEvaluators,
        projectId,
        cellTraceIds,
        completedTargetEvaluatorScores,
      });
    }

    await dispatchEventToClickHouse({
      event,
      projectId,
      runId,
      experimentId,
      datasetRows,
      state,
      loadedEvaluators,
      commands,
      chDispatchStats,
    });
  };
};

type OrchestratorRunSetup = {
  runId: string;
  concurrency: number;
  cells: ExecutionCell[];
  progress: OrchestratorProgressState;
  commands: ReturnType<typeof getApp>["experimentRuns"];
  chDispatchStats: ChDispatchStats;
  resultMapperConfig: ResultMapperConfig;
  processEventForStorage: (event: EvaluationV3Event) => Promise<void>;
  completedTargetOutputs: Map<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
  completedTargetEvaluatorScores: Map<
    string,
    Array<{ name: string; score?: number; label?: string; passed?: boolean }>
  >;
  producedTargetKeys: Set<string>;
};

type OrchestratorRunTrackers = {
  cellTraceIds: Map<string, string>;
  completedTargetOutputs: Map<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
  /**
   * `${rowIndex}:${targetId}` keys this run actually executed, as opposed to
   * inherited via seedTargetOutputs. Lets the Phase-2 block tell "we computed
   * this" from "we reused this", so only the reused ones need back-filling
   * into the run's stored results.
   */
  producedTargetKeys: Set<string>;
  completedTargetEvaluatorScores: Map<
    string,
    Array<{ name: string; score?: number; label?: string; passed?: boolean }>
  >;
};

/**
 * Builds the per-run storage trackers: traceId-by-cell (pre-seeded from any
 * cell that already carries one), completed target outputs (pre-seeded from
 * the client's prior-run outputs so Phase 2 can reuse them), the keys this
 * run actually produced, and per-target evaluator scores for Phase 2.
 */
const buildOrchestratorTrackers = ({
  cells,
  seedTargetOutputs,
}: {
  cells: ExecutionCell[];
  seedTargetOutputs?: Record<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
}): OrchestratorRunTrackers => {
  // Track traceId per cell so evaluator_result events can reference it
  const cellTraceIds = new Map<string, string>();

  // Track per-(row, target) outputs as Phase 1 cells complete, so Phase 2
  // pairwise cells (#5100) can bake both variants' outputs into their input
  // payload before they execute. Pre-seed from prior-run outputs the client
  // already has — covers the "variants already ran, user just added the
  // pairwise column" case so Phase 2 doesn't redundantly force a re-run.
  const completedTargetOutputs = new Map<
    string,
    { output: unknown; cost?: number; duration?: number }
  >();
  if (seedTargetOutputs) {
    for (const [key, value] of Object.entries(seedTargetOutputs)) {
      completedTargetOutputs.set(key, value);
    }
  }

  const producedTargetKeys = new Set<string>();

  // Track per-(row, target) evaluator results so the Phase 2 pairwise judge
  // can read each variant's existing evaluator scores (relevance, factuality,
  // etc.) and factor them into its verdict. Keyed by `${rowIndex}:${targetId}`,
  // value is an array of one entry per evaluator that produced a usable score.
  const completedTargetEvaluatorScores = new Map<
    string,
    Array<{ name: string; score?: number; label?: string; passed?: boolean }>
  >();

  // Pre-seed from cells that already have a traceId (e.g., evaluator reruns
  // that skip target execution and won't generate target_result events)
  for (const cell of cells) {
    if (cell.traceId) {
      cellTraceIds.set(`${cell.rowIndex}:${cell.targetId}`, cell.traceId);
    }
  }

  return {
    cellTraceIds,
    completedTargetOutputs,
    producedTargetKeys,
    completedTargetEvaluatorScores,
  };
};

/**
 * Generates the run's cells and its progress accumulator (seeded from
 * Phase-1's cell count), and logs the run kickoff.
 */
const buildRunCellsAndProgress = ({
  runId,
  scope,
  state,
  datasetRows,
  seedTargetOutputs,
}: {
  runId: string;
  scope: ExecutionScope;
  state: EvaluationsV3State;
  datasetRows: Array<Record<string, unknown>>;
  seedTargetOutputs?: Record<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
}): { cells: ExecutionCell[]; progress: OrchestratorProgressState } => {
  // Generate cells to execute
  const cells = generateCells({
    state,
    datasetRows,
    scope,
    options: { seedTargetOutputs },
  });

  // Phase-1 count only; grows by the Phase-2 (comparison) cell count once
  // those are generated after Phase 1 finishes, so the final summary's
  // completedCells (which counts both phases) never exceeds totalCells.
  const progress: OrchestratorProgressState = {
    totalCells: cells.length,
    totalCost: 0,
    failedCells: 0,
    completedCells: 0,
    completed: 0,
    aborted: false,
  };

  logger.info(
    {
      runId,
      totalCells: progress.totalCells,
      scopeType: scope.type,
      targetCount: state.targets.length,
    },
    "Starting orchestrator",
  );

  return { cells, progress };
};

/**
 * Builds target metadata + result-mapper config, dispatches the ClickHouse
 * start-of-run event, and wires up the per-event storage callback — the
 * final leg of {@link initializeOrchestratorRun}.
 */
const completeOrchestratorSetup = async ({
  input,
  runId,
  concurrency,
  cells,
  progress,
  commands,
  chDispatchStats,
  trackers,
}: {
  input: OrchestratorInput;
  runId: string;
  concurrency: number;
  cells: ExecutionCell[];
  progress: OrchestratorProgressState;
  commands: ReturnType<typeof getApp>["experimentRuns"];
  chDispatchStats: ChDispatchStats;
  trackers: OrchestratorRunTrackers;
}): Promise<OrchestratorRunSetup> => {
  const {
    projectId,
    experimentId,
    workflowVersionId,
    state,
    datasetRows,
    loadedPrompts,
    loadedAgents,
    loadedEvaluators,
    loadedWorkflows,
  } = input;

  // Build target metadata for storage (model + name attribution — see
  // buildTargetMetadata's JSDoc).
  const targetMetadata: ESBatchEvaluationTarget[] = buildTargetMetadata({
    targets: state.targets,
    loadedPrompts,
    loadedAgents,
    loadedEvaluators,
    loadedWorkflows,
  });

  // Build config for result mapper - determines which evaluators have scores stripped
  const resultMapperConfig: ResultMapperConfig = {
    stripScoreEvaluatorIds: buildStripScoreEvaluatorIds(state.evaluators),
  };

  await dispatchStartExperimentRun({
    experimentId,
    projectId,
    runId,
    workflowVersionId,
    total: progress.totalCells,
    targetMetadata,
    chDispatchStats,
    commands,
  });

  const processEventForStorage = createProcessEventForStorage({
    projectId,
    runId,
    experimentId,
    state,
    loadedEvaluators,
    datasetRows,
    commands,
    chDispatchStats,
    cellTraceIds: trackers.cellTraceIds,
    completedTargetOutputs: trackers.completedTargetOutputs,
    producedTargetKeys: trackers.producedTargetKeys,
    completedTargetEvaluatorScores: trackers.completedTargetEvaluatorScores,
  });

  return {
    runId,
    concurrency,
    cells,
    progress,
    commands,
    chDispatchStats,
    resultMapperConfig,
    processEventForStorage,
    completedTargetOutputs: trackers.completedTargetOutputs,
    completedTargetEvaluatorScores: trackers.completedTargetEvaluatorScores,
    producedTargetKeys: trackers.producedTargetKeys,
  };
};

/**
 * Builds everything a run needs before its first event: the cell list,
 * progress accumulator, storage trackers, target metadata, and the
 * ClickHouse start-of-run dispatch.
 */
const initializeOrchestratorRun = async (
  input: OrchestratorInput,
): Promise<OrchestratorRunSetup> => {
  const {
    projectId,
    scope,
    state,
    datasetRows,
    runId: providedRunId,
    concurrency: requestedConcurrency,
    seedTargetOutputs,
  } = input;

  // Use requested concurrency, environment variable, or default
  const concurrency = requestedConcurrency ?? DEFAULT_CONCURRENCY;

  // Use provided run ID or generate a human-readable one like "swift-fox-42"
  const runId = providedRunId ?? generateHumanReadableId();

  const { cells, progress } = buildRunCellsAndProgress({
    runId,
    scope,
    state,
    datasetRows,
    seedTargetOutputs,
  });

  // Set running flag + record the owner so abort can authorize this run even
  // on the interactive SSE path, which never creates a polling run-state record.
  await abortManager.setRunning(runId, projectId);

  // Get commands for ClickHouse dual-write (unconditional)
  const commands = getApp().experimentRuns;

  // Track CH dispatch failures for observability
  const chDispatchStats: ChDispatchStats = { total: 0, failures: 0 };

  const trackers = buildOrchestratorTrackers({ cells, seedTargetOutputs });

  return completeOrchestratorSetup({
    input,
    runId,
    concurrency,
    cells,
    progress,
    commands,
    chDispatchStats,
    trackers,
  });
};

const buildOrchestratorRunContext = ({
  input,
  runId,
  setup,
  pushEvent,
  semaphore,
  activeCells,
}: {
  input: OrchestratorInput;
  runId: string;
  setup: OrchestratorRunSetup;
  pushEvent: (event: EvaluationV3Event) => void;
  semaphore: ReturnType<typeof createSemaphore>;
  activeCells: Set<Promise<void>>;
}): OrchestratorRunContext => ({
  runId,
  projectId: input.projectId,
  scope: input.scope,
  state: input.state,
  datasetRows: input.datasetRows,
  datasetColumns: input.datasetColumns,
  loadedPrompts: input.loadedPrompts,
  loadedAgents: input.loadedAgents,
  loadedEvaluators: input.loadedEvaluators,
  loadedWorkflows: input.loadedWorkflows,
  resultMapperConfig: setup.resultMapperConfig,
  seedTargetOutputs: input.seedTargetOutputs,
  completedTargetOutputs: setup.completedTargetOutputs,
  completedTargetEvaluatorScores: setup.completedTargetEvaluatorScores,
  producedTargetKeys: setup.producedTargetKeys,
  pushEvent,
  processEventForStorage: setup.processEventForStorage,
  semaphore,
  activeCells,
  progress: setup.progress,
});

/**
 * Drains the event channel as cells run, waits for background processing to
 * finish, dispatches the run's completion to ClickHouse, and yields the
 * terminal `stopped`/`done` event.
 */
/** Dispatches the run-completion event to ClickHouse. A no-op when the run has no `experimentId`. */
const dispatchCompleteExperimentRun = async ({
  runId,
  projectId,
  experimentId,
  progress,
  finishedAt,
  commands,
  chDispatchStats,
}: {
  runId: string;
  projectId: string;
  experimentId: string | undefined;
  progress: OrchestratorProgressState;
  finishedAt: number;
  commands: ReturnType<typeof getApp>["experimentRuns"];
  chDispatchStats: ChDispatchStats;
}): Promise<void> => {
  if (!experimentId) return;

  chDispatchStats.total++;
  await commands
    .completeExperimentRun({
      tenantId: projectId,
      runId,
      experimentId,
      finishedAt: progress.aborted ? null : finishedAt,
      stoppedAt: progress.aborted ? finishedAt : null,
      occurredAt: Date.now(),
    })
    .catch((err) => {
      chDispatchStats.failures++;
      logger.warn(
        { err, runId },
        "Failed to dispatch completeExperimentRun to CH",
      );
    });
};

const logChDispatchFailureSummary = ({
  runId,
  chDispatchStats,
}: {
  runId: string;
  chDispatchStats: ChDispatchStats;
}): void => {
  if (chDispatchStats.failures === 0) return;
  logger.warn(
    {
      runId,
      chDispatchFailures: chDispatchStats.failures,
      chDispatchTotal: chDispatchStats.total,
    },
    `${chDispatchStats.failures} of ${chDispatchStats.total} CH dispatches failed for run ${runId}`,
  );
};

/** Yields the run's terminal event: `done` with a summary when it completed, or just a log line when aborted. */
async function* yieldOrchestratorTerminalEvent({
  runId,
  progress,
  startTime,
  chDispatchStats,
}: {
  runId: string;
  progress: OrchestratorProgressState;
  startTime: number;
  chDispatchStats: ChDispatchStats;
}): AsyncGenerator<EvaluationV3Event> {
  if (!progress.aborted) {
    const finishedAt = Date.now();
    const duration = finishedAt - startTime;

    logger.info(
      {
        runId,
        completedCells: progress.completedCells,
        failedCells: progress.failedCells,
        totalCells: progress.totalCells,
        duration,
        totalCost: progress.totalCost,
      },
      "Evaluation execution completed successfully",
    );

    // Emit done with summary
    const summary: ExecutionSummary = {
      runId,
      totalCells: progress.totalCells,
      completedCells: progress.completedCells,
      failedCells: progress.failedCells,
      duration,
      ...(chDispatchStats.failures > 0 && {
        chDispatchFailures: chDispatchStats.failures,
      }),
      timestamps: {
        startedAt: startTime,
        finishedAt,
      },
    };

    yield {
      type: "done",
      summary,
    };
  } else {
    const duration = Date.now() - startTime;
    logger.info(
      {
        runId,
        completedCells: progress.completedCells,
        failedCells: progress.failedCells,
        totalCells: progress.totalCells,
        duration,
      },
      "Evaluation execution stopped by user",
    );
  }
}

/**
 * Drains the event channel as cells run, waits for background processing to
 * finish, dispatches the run's completion to ClickHouse, and yields the
 * terminal `stopped`/`done` event.
 */
async function* finalizeOrchestratorRun({
  runId,
  projectId,
  experimentId,
  progress,
  processingPromise,
  waitForEvent,
  commands,
  chDispatchStats,
  startTime,
}: {
  runId: string;
  projectId: string;
  experimentId: string | undefined;
  progress: OrchestratorProgressState;
  processingPromise: Promise<void>;
  waitForEvent: () => Promise<EvaluationV3Event | null>;
  commands: ReturnType<typeof getApp>["experimentRuns"];
  chDispatchStats: ChDispatchStats;
  startTime: number;
}): AsyncGenerator<EvaluationV3Event> {
  try {
    // Yield events as they arrive
    while (true) {
      const event = await waitForEvent();
      if (event === null) break;
      yield event;
    }

    // Emit stopped event if aborted
    if (progress.aborted) {
      logger.info(
        {
          runId,
          completedCells: progress.completedCells,
          totalCells: progress.totalCells,
        },
        "Emitting stopped event",
      );
      yield {
        type: "stopped",
        reason: "user",
      };
    }

    // Ensure processing is complete
    await processingPromise;
  } finally {
    // Clear running flag
    await abortManager.clearRunning(runId);
    await abortManager.clearAbort(runId);

    await dispatchCompleteExperimentRun({
      runId,
      projectId,
      experimentId,
      progress,
      finishedAt: Date.now(),
      commands,
      chDispatchStats,
    });
  }

  logChDispatchFailureSummary({ runId, chDispatchStats });

  yield* yieldOrchestratorTerminalEvent({
    runId,
    progress,
    startTime,
    chDispatchStats,
  });
}

/**
 * Main orchestrator - executes all cells and yields SSE events.
 * Uses parallel execution with semaphore-based rate limiting.
 */
export async function* runOrchestrator(
  input: OrchestratorInput,
): AsyncGenerator<EvaluationV3Event> {
  const setup = await initializeOrchestratorRun(input);
  const { runId, concurrency, cells, progress, commands, chDispatchStats } =
    setup;

  // Emit execution_started
  yield {
    type: "execution_started",
    runId,
    total: progress.totalCells,
  };

  const startTime = Date.now();

  logger.info(
    {
      runId,
      totalCells: progress.totalCells,
      concurrency,
      experimentId: input.experimentId,
    },
    "Starting evaluation execution",
  );

  // Event queue for collecting results from parallel executions
  const { pushEvent, signalComplete, waitForEvent } = createEventChannel();

  // Create semaphore for rate limiting
  const semaphore = createSemaphore(concurrency);

  // Track active cell executions
  const activeCells = new Set<Promise<void>>();

  const ctx = buildOrchestratorRunContext({
    input,
    runId,
    setup,
    pushEvent,
    semaphore,
    activeCells,
  });

  // Start processing cells in background
  const processingPromise = (async () => {
    try {
      // Process cells in parallel with rate limiting
      await runPhase1Cells({ cells, ctx });

      await runComparisonPhase({ ctx });
    } finally {
      // Signal that all cells are complete
      signalComplete();
    }
  })();

  yield* finalizeOrchestratorRun({
    runId,
    projectId: input.projectId,
    experimentId: input.experimentId,
    progress,
    processingPromise,
    waitForEvent,
    commands,
    chDispatchStats,
    startTime,
  });
}

type LoadedTargetSourceData = {
  prompt?: VersionedPrompt;
  agent?: TypedAgent;
  workflow?: LoadedWorkflow;
};

const resolvePromptTargetData = ({
  targetConfig,
  loadedPrompts,
}: {
  targetConfig: TargetConfig;
  loadedPrompts: Map<string, VersionedPrompt>;
}): LoadedTargetSourceData | undefined => {
  if (targetConfig.type !== "prompt" || !targetConfig.promptId)
    return undefined;
  const prompt = loadedPrompts.get(targetConfig.promptId);
  return prompt ? { prompt } : undefined;
};

/**
 * A workflow-type agent has no code of its own — it wraps a Studio
 * workflow, resolved by dataLoader and cached under the linked
 * workflow's own id (see loadPublishedWorkflow in dataLoader.ts).
 */
const resolveAgentTargetData = ({
  targetConfig,
  loadedAgents,
  loadedWorkflows,
}: {
  targetConfig: TargetConfig;
  loadedAgents: Map<string, TypedAgent>;
  loadedWorkflows?: Map<string, LoadedWorkflow>;
}): LoadedTargetSourceData | undefined => {
  if (targetConfig.type !== "agent" || !targetConfig.dbAgentId)
    return undefined;
  const agent = loadedAgents.get(targetConfig.dbAgentId);
  if (!agent) return undefined;

  if (agent.type !== "workflow") return { agent };

  const linkedWorkflowId =
    agent.workflowId ?? (agent.config as { workflow_id?: string }).workflow_id;
  const workflow = linkedWorkflowId
    ? loadedWorkflows?.get(workflowLoadKey({ workflowId: linkedWorkflowId }))
    : undefined;
  return { agent, workflow };
};

const resolveWorkflowTargetData = ({
  targetConfig,
  loadedWorkflows,
}: {
  targetConfig: TargetConfig;
  loadedWorkflows?: Map<string, LoadedWorkflow>;
}): LoadedTargetSourceData | undefined => {
  if (targetConfig.type !== "workflow" || !targetConfig.workflowId) {
    return undefined;
  }
  const workflow = loadedWorkflows?.get(workflowLoadKey(targetConfig));
  return workflow ? { workflow } : undefined;
};

/**
 * Gets loaded prompt/agent data for a target.
 */
const getLoadedDataForTarget = ({
  targetConfig,
  loadedPrompts,
  loadedAgents,
  loadedWorkflows,
}: {
  targetConfig: TargetConfig;
  loadedPrompts: Map<string, VersionedPrompt>;
  loadedAgents: Map<string, TypedAgent>;
  loadedWorkflows?: Map<string, LoadedWorkflow>;
}): LoadedTargetSourceData =>
  // For local configs (none of the three resolve), no pre-loaded data needed.
  resolvePromptTargetData({ targetConfig, loadedPrompts }) ??
  resolveAgentTargetData({ targetConfig, loadedAgents, loadedWorkflows }) ??
  resolveWorkflowTargetData({ targetConfig, loadedWorkflows }) ??
  {};

/**
 * Requests abort of a running execution.
 */
export const requestAbort = async (runId: string): Promise<void> => {
  await abortManager.requestAbort(runId);
};
