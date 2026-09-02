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
import { comparisonDependencies } from "~/experiments-v3/execution/buildExecutionRequest";
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
import {
  CONNECTED_OUTPUT_FIELD,
  connectedParameterDefinitions,
} from "~/experiments-v3/utils/connectedAgentTarget";
import { isRowEmpty } from "~/experiments-v3/utils/emptyRowDetection";
import { toComparisonConfig } from "~/experiments-v3/utils/normalizeComparison";
import { disambiguateNames } from "~/experiments-v3/utils/variantDisambiguation";
import { addEnvs } from "~/optimization_studio/server/addEnvs";
import { loadDatasets } from "~/optimization_studio/server/loadDatasets";
import type {
  ConnectedComponentConfig,
  ExecutionState,
  Workflow,
} from "~/optimization_studio/types/dsl";
import type {
  StudioClientEvent,
  StudioServerEvent,
} from "~/optimization_studio/types/events";
import { nodeErrorToDomainError } from "~/optimization_studio/utils/nodeErrorDomain";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { tryGetAgentSandboxApiKey } from "~/server/api-key/agent-sandbox-key";
import { getApp } from "~/server/app-layer/app";
import type {
  DispatchAgent,
  DispatchCall,
} from "~/server/connected-agents/call.dispatcher";
import type { CallOutcome } from "~/server/connected-agents/call-envelope";
import {
  BUSY_RETRY_AFTER_MS,
  DEFAULT_CALL_TIMEOUT_MS,
  MAX_CALL_TIMEOUT_MS,
} from "~/server/connected-agents/constants";
import { AgentBusyError } from "~/server/connected-agents/errors";
import { getConnectedAgentRuntime } from "~/server/connected-agents/runtime";
import { prisma } from "~/server/db";
import type {
  EvaluatorTypes,
  SingleEvaluationResult,
} from "~/server/evaluations/evaluators";
import { AVAILABLE_EVALUATORS } from "~/server/evaluations/evaluators";
import type {
  RecordEvaluatorResultCommandData,
  RecordTargetResultCommandData,
} from "~/server/event-sourcing/pipelines/experiment-run-processing/schemas/commands";
import type { ESBatchEvaluationTarget } from "~/server/experiments/types";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import type { RunActor } from "~/server/scenarios/run-actor";
import { assertConnectedAgentsRunnable } from "~/server/suites/connected-targets";
import {
  estimateCost,
  getMatchingLLMModelCost,
} from "~/server/tracer/collector/cost";
import { KSUID_RESOURCES } from "~/utils/constants";
import { generateHumanReadableId } from "~/utils/humanReadableId";
import { generateOtelSpanId, generateOtelTraceId } from "~/utils/trace";
import { abortManager } from "./abortManager";
import {
  buildConnectedCall,
  CONNECTED_BUSY_RETRY_BUDGET_MS,
  CONNECTED_REQUEST_SLACK_MS,
  connectedCallFailure,
  connectedOutputText,
} from "./connectedTarget";
import {
  type LoadedWorkflow,
  promptLoadKey,
  workflowLoadKey,
} from "./dataLoader";
import { EvaluatorNoInputsResolvedError } from "./errors";
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
  type CarriedOverCell,
  type EvaluationV3Event,
  type ExecutionCell,
  type ExecutionScope,
  type ExecutionSummary,
  UNNAMED_FAILURE,
} from "./types";
import {
  buildCellWorkflow,
  buildEvaluatorCellWorkflow,
} from "./workflowBuilder";

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
  /**
   * Board cells the run carries rather than produces, so the run holds the
   * whole board and not only the column that was clicked.
   */
  carriedOverCells?: CarriedOverCell[];
  /**
   * Who started the run, when a person did.
   *
   * Read for one decision: a personal development agent belongs to the person
   * whose key registered it, and only that person may send a turn to the
   * process on their machine. A run that names no person is refused by the
   * same rule, exactly as a simulation is.
   */
  actor?: RunActor;
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
  // A row named twice is still one row. Kept as-sent otherwise, so the run
  // covers the rows in the order the caller asked for.
  const picked = (indices: number[]) =>
    Array.from(new Set(indices.filter(inRange)));

  switch (scope.type) {
    case "full":
    case "target":
    case "evaluator-all-rows":
      return allRows();
    case "rows":
      return picked(scope.rowIndices);
    case "target-rows":
      return scope.rowIndices ? picked(scope.rowIndices) : allRows();
    case "cell":
    case "evaluator":
      return [scope.rowIndex].filter(inRange);
    default:
      return [];
  }
};

/**
 * The dataset id a run reads its mapping buckets from.
 *
 * Rows come from the ACTIVE dataset, so `mappings[datasetId]` has to be keyed
 * on that same dataset. The saved-state path hands the orchestrator EVERY
 * dataset the workbench has, and the active one is not always the first, so
 * reading `datasets[0]` there picks another dataset's bucket and every node
 * runs with no inputs. The first dataset stays as the fallback for state that
 * names no active dataset.
 */
const resolveMappingDatasetId = (
  state: Pick<EvaluationsV3State, "datasets" | "activeDatasetId">,
): string => {
  const activeId = state.activeDatasetId;
  if (activeId && state.datasets.some((d) => d.id === activeId)) {
    return activeId;
  }
  return state.datasets[0]?.id ?? activeId ?? "dataset-1";
};

/**
 * Generates all cells to execute based on the scope.
 */
export const generateCells = (
  state: Pick<
    EvaluationsV3State,
    "datasets" | "activeDatasetId" | "targets" | "evaluators"
  >,
  datasetRows: Array<Record<string, unknown>>,
  scope: ExecutionScope,
  options: {
    seedTargetOutputs?: Record<
      string,
      { output: unknown; cost?: number; duration?: number }
    >;
  } = {},
): ExecutionCell[] => {
  const cells: ExecutionCell[] = [];
  const datasetId = resolveMappingDatasetId(state);

  // Handle evaluator-all-rows scope - run one evaluator across all rows with existing target outputs
  if (scope.type === "evaluator-all-rows") {
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
  }

  // Handle evaluator scope specially - single evaluator re-run with pre-computed target output
  if (scope.type === "evaluator") {
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
  }

  // Determine which rows to process. Shared with Phase 2's comparison cells so
  // the two phases can never disagree about what's in scope.
  const rowIndices = resolveScopedRowIndices({
    scope,
    rowCount: datasetRows.length,
  });

  // Determine which targets to process.
  //
  // A scoped run that touches a comparison needs the OTHER columns that
  // comparison reads, or Phase 2 has nothing to judge. Two shapes reach this
  // and both used to leave the same hole:
  //
  //   - a comparison column-target: hitting Play on it alone dispatched only
  //     that column, which Phase 1 always skips, so the run finished with 0
  //     cells and "No verdict yet" everywhere;
  //   - a chip comparison whose variants are plain columns: running one
  //     candidate alone left the judge with no output for the others, and
  //     Phase 2 wrote "Waiting on …" over verdicts nobody asked to re-run.
  //
  // Expanding covers the columns the run has nothing saved for; the caller's
  // `seedTargetOutputs` covers the rest, and the loop below skips those.
  const comparisonDeps = (id: string): string[] =>
    comparisonDependencies({
      targets: state.targets,
      evaluators: state.evaluators,
      targetId: id,
    });

  const expandComparisonDeps = (id: string): string[] => {
    const deps = comparisonDeps(id);
    if (deps.length === 0) return [id];
    return Array.from(new Set([...deps, id]));
  };

  const targetIds =
    scope.type === "full"
      ? state.targets.map((t: TargetConfig) => t.id)
      : scope.type === "rows"
        ? state.targets.map((t: TargetConfig) => t.id)
        : scope.type === "target"
          ? expandComparisonDeps(scope.targetId)
          : scope.type === "target-rows"
            ? Array.from(new Set(scope.targetIds.flatMap(expandComparisonDeps)))
            : scope.type === "cell"
              ? expandComparisonDeps(scope.targetId)
              : [];

  const scopedComparisonDeps = new Set(
    (scope.type === "target" || scope.type === "cell"
      ? [scope.targetId]
      : scope.type === "target-rows"
        ? scope.targetIds
        : []
    ).flatMap(comparisonDeps),
  );

  // Generate cells, skipping empty rows
  for (const rowIndex of rowIndices) {
    const datasetEntry = datasetRows[rowIndex];
    if (!datasetEntry) continue;

    // Skip completely empty rows
    if (isRowEmpty(datasetEntry)) {
      logger.debug({ rowIndex }, "Skipping empty row");
      continue;
    }

    for (const targetId of targetIds) {
      if (
        scopedComparisonDeps.has(targetId) &&
        options.seedTargetOutputs?.[`${rowIndex}:${targetId}`]
      ) {
        continue;
      }

      const targetConfig = state.targets.find(
        (t: TargetConfig) => t.id === targetId,
      );
      if (!targetConfig) continue;

      // Skip column-style comparison targets (pairwise #5100, N-way #5101)
      // in Phase 1 — they need every variant's output, which is not yet
      // available in a single per-target cell. Picked up by
      // generateComparisonCells in Phase 2.
      if (
        targetConfig.type === "evaluator" &&
        isComparisonEvaluator(targetConfig)
      ) {
        continue;
      }

      cells.push({
        rowIndex,
        targetId,
        targetConfig,
        // Comparison evaluators (pairwise #5100, N-way #5101) run in Phase 2
        // once every variant's output exists — they would crash here because
        // the other candidates' outputs are not available within a single
        // per-target cell. See generateComparisonCells.
        evaluatorConfigs: state.evaluators.filter(
          (e) => !isComparisonEvaluator(e),
        ),
        datasetEntry: {
          _datasetId: datasetId,
          ...datasetEntry,
        },
      });
    }
  }

  return cells;
};

/**
 * How many cells a scope will dispatch, before the run starts.
 *
 * A polling run publishes its total when it registers, which is before the
 * orchestrator has produced anything. Counting rows times every target
 * overstates every scope that names a subset of the targets, and the run's
 * progress then never reaches its own total. Counting the plan itself is the
 * only count that cannot disagree with what runs, comparison dependencies
 * included. Phase 1 only, as `runOrchestrator` starts from the same number and
 * adds the comparison cells once it knows how many there are.
 */
export const countScopedCells = ({
  state,
  datasetRows,
  scope,
  seedTargetOutputs,
}: {
  state: Pick<
    EvaluationsV3State,
    "datasets" | "activeDatasetId" | "targets" | "evaluators"
  >;
  datasetRows: Array<Record<string, unknown>>;
  scope: ExecutionScope;
  seedTargetOutputs?: Record<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
}): number =>
  generateCells(
    state,
    datasetRows,
    scope,
    seedTargetOutputs ? { seedTargetOutputs } : {},
  ).length;

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
   *  - "too-few-variants": fewer than two columns are picked, so there is
   *    nothing to compare against.
   *  - "golden-not-set": the comparison is set to judge against a golden
   *    answer but no dataset column is picked for it.
   *  - "variant-not-found": a picked column no longer exists in the workbench.
   *
   * The last three are setup problems rather than data problems: no cell can be
   * built for ANY row until the user finishes configuring the comparison.
   */
  kind:
    | "missing-output"
    | "empty-output"
    | "too-few-variants"
    | "golden-not-set"
    | "variant-not-found";
  /** Display-friendly identifiers of the variants that triggered the skip. */
  variantNames: string[];
};

/** Why one comparison could not be resolved into cells at all. */
type ComparisonSetupSkip = Extract<
  ComparisonSkipReason["kind"],
  "too-few-variants" | "golden-not-set" | "variant-not-found"
>;

/**
 * "a", "a and b", "a, b and c" — for the skip-reason message, which used to be
 * able to assume exactly two variants.
 */
export const formatList = (names: string[]): string => {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

/**
 * The row-level error copy for a skipped comparison: what happened, and the one
 * thing the user can do about it.
 *
 * Exported so the wording and the `error_type` are pinned by tests without
 * running a whole orchestration.
 */
export const comparisonSkipMessage = (
  reason: Pick<ComparisonSkipReason, "kind" | "variantNames">,
): { detail: string; errorType: string } => {
  const which = formatList(reason.variantNames);
  switch (reason.kind) {
    case "missing-output":
      return {
        detail: `Waiting on ${which}: no ${
          reason.variantNames.length > 1 ? "outputs" : "output"
        } for this row yet. Run ${which} first, then re-run this comparison.`,
        errorType: "MissingVariantOutput",
      };
    case "empty-output":
      // Re-running will not help: the output is empty or the picked field is
      // gone. Point the user at the output-field config.
      return {
        detail: `${which} produced no text to compare for this row. Check the output field selected for ${which}.`,
        errorType: "EmptyVariantOutput",
      };
    case "too-few-variants":
      return {
        detail:
          "This comparison needs at least 2 columns to compare. Pick the columns to compare in the evaluator settings, then run again.",
        errorType: "TooFewComparisonVariants",
      };
    case "golden-not-set":
      return {
        detail:
          "This comparison judges against a golden answer but no column is picked for it. Pick the golden field in the evaluator settings, then run again.",
        errorType: "GoldenFieldNotSet",
      };
    case "variant-not-found":
      return {
        detail:
          "A column this comparison compares no longer exists. Pick the columns to compare in the evaluator settings, then run again.",
        errorType: "ComparisonVariantNotFound",
      };
  }
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
  state: Pick<
    EvaluationsV3State,
    "datasets" | "activeDatasetId" | "targets" | "evaluators"
  >;
  datasetRows: Array<Record<string, unknown>>;
  completedTargetOutputs: Map<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
  completedTargetEvaluatorScores?: Map<
    string,
    Array<{ name: string; score?: number; label?: string; passed?: boolean }>
  >;
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
  const cells: ExecutionCell[] = [];
  const skipReasons: ComparisonSkipReason[] = [];
  const datasetId = resolveMappingDatasetId(state);
  const rowsInScope =
    scopedRowIndices ?? datasetRows.map((_, rowIndex) => rowIndex);

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

  /**
   * A variant's existing evaluator scores, rendered as a block to append to its
   * candidate text so the judge can factor them into the verdict. Empty when
   * there are no scores, or when none of them carry a value.
   *
   * This appends to text the caller has already produced, rather than
   * serializing the output a second time itself — `toCandidateText` is the one
   * place that turns an output into judge-readable text, structured or not.
   */
  const evaluatorScoresBlock = (
    rowIndex: number,
    variantId: string,
  ): string => {
    const scores = completedTargetEvaluatorScores?.get(
      `${rowIndex}:${variantId}`,
    );
    if (!scores?.length) return "";
    const lines = scores
      .map((s) => {
        const parts: string[] = [];
        if (s.score !== undefined) parts.push(`score=${s.score}`);
        if (s.label !== undefined) parts.push(`label=${s.label}`);
        if (s.passed !== undefined) parts.push(`passed=${s.passed}`);
        if (parts.length === 0) return null;
        return `- ${s.name}: ${parts.join(", ")}`;
      })
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
  const variantIdentifierFor = (t: TargetConfig): string => {
    if (t.type === "prompt" && t.promptId) {
      const handle = loadedPrompts?.get(promptLoadKey(t))?.handle;
      if (handle) return handle;
    }
    return t.id;
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
  const buildVariantIdentifiers = (
    resolvedVariants: TargetConfig[],
  ): string[] => {
    const raw = resolvedVariants.map(variantIdentifierFor);
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
  const variantDisplayNameFor = (t: TargetConfig): string => {
    if (t.type === "prompt") {
      if (!t.promptId) return "New Prompt";
      const loaded = loadedPrompts?.get(promptLoadKey(t));
      return loaded?.handle ?? loaded?.name ?? "New Prompt";
    }
    if (t.type === "evaluator" && t.targetEvaluatorId) {
      return loadedEvaluators?.get(t.targetEvaluatorId)?.name ?? t.id;
    }
    // Agents/workflows: no loaded entity map is threaded into this function, so
    // fall back to the collision-safe identifier — same as before this helper.
    return variantIdentifierFor(t);
  };

  /**
   * Display names for a comparison's variants, with the same "(1)/(2)" suffixing
   * the config UI applies to same-name variants — so "support-detailed" run
   * twice reads as "support-detailed (1)" / "(2)" in the skip message, matching
   * the variant cards, instead of two identical names or two raw ids.
   */
  const buildVariantDisplayNames = (
    resolvedVariants: TargetConfig[],
  ): string[] => disambiguateNames(resolvedVariants.map(variantDisplayNameFor));

  /**
   * Resolve configured variant ids to their TargetConfigs, or the reason the
   * comparison is unusable. Applies the same "is this comparison usable" gate
   * to every comparison carrier — chip-style (evaluator.comparison) and
   * column-style (target.comparison) alike — so a comparison missing its
   * golden field (see isGoldenFieldSatisfied, #5378) is skipped consistently
   * rather than running with an empty `golden` while its settings claim
   * golden-aware.
   *
   * Every skip is returned rather than only logged: an unfinished comparison
   * produces no cell for any row, and a column that renders "No verdict yet"
   * forever tells the user nothing about what to fix.
   */
  const resolveVariants = (
    cfg: ComparisonEvaluatorConfig,
    ownerId: string,
  ):
    | { variants: TargetConfig[]; skip?: never }
    | { skip: ComparisonSetupSkip; variants?: never } => {
    if (!cfg.variants || cfg.variants.length < 2) {
      logger.warn(
        { ownerId, variants: cfg.variants },
        "Comparison skipped: fewer than 2 variants configured",
      );
      return { skip: "too-few-variants" };
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
      return { skip: "golden-not-set" };
    }
    const resolved = cfg.variants.map((id) =>
      state.targets.find((t) => t.id === id),
    );
    if (resolved.some((t) => !t)) {
      logger.warn(
        { ownerId, variants: cfg.variants },
        "Comparison skipped: one or more variant targets not found",
      );
      return { skip: "variant-not-found" };
    }
    return { variants: resolved as TargetConfig[] };
  };

  /**
   * The column a chip-style comparison's verdict hangs under: its first
   * variant. An unfinished comparison still needs one, so the first variant
   * that names a target the workbench still has is used. With none, the
   * comparison has no cell in the grid to report into and the log line above
   * is all there is.
   */
  const anchorVariantId = (
    cfg: ComparisonEvaluatorConfig,
  ): string | undefined =>
    (cfg.variants ?? []).find((id) => state.targets.some((t) => t.id === id));

  /** One error row per scoped row for a comparison that cannot be built. */
  const pushSetupSkips = ({
    kind,
    targetId,
    evaluatorId,
  }: {
    kind: ComparisonSetupSkip;
    targetId: string;
    evaluatorId: string;
  }): void => {
    for (const rowIndex of rowsInScope) {
      const datasetEntry = datasetRows[rowIndex];
      // The same gate `generateCells` applies: a blank trailing row never ran,
      // so an unfinished comparison must not paint a red cell onto it.
      if (!datasetEntry || isRowEmpty(datasetEntry)) continue;
      skipReasons.push({
        rowIndex,
        targetId,
        evaluatorId,
        kind,
        variantNames: [],
      });
    }
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
  const isLegacyPairwiseBacked = (
    dbEvaluatorId: string | undefined,
  ): boolean => {
    if (!dbEvaluatorId) return false;
    const dbConfig = loadedEvaluators?.get(dbEvaluatorId)?.config as
      | { evaluatorType?: string }
      | undefined;
    return dbConfig?.evaluatorType === LEGACY_PAIRWISE_EVALUATOR_TYPE;
  };

  /**
   * The candidate payload for one row, or the names of the variants that had
   * no output. Applies structured-output narrowing and score augmentation in
   * the config's variant order — that order is what the judge's deterministic
   * shuffle is seeded against.
   */
  const buildCandidates = (
    cfg: ComparisonEvaluatorConfig,
    resolvedVariants: TargetConfig[],
    variantIds: string[],
    variantDisplayNames: string[],
    rowIndex: number,
  ):
    | {
        candidates: ExecutionCell["comparison"];
        missing?: never;
        empty?: never;
      }
    | { candidates?: never; missing: string[]; empty?: never }
    | { candidates?: never; missing?: never; empty: string[] } => {
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
        output: text ? text + evaluatorScoresBlock(rowIndex, variantId) : text,
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

  // Chip-style comparison evaluators. The verdict is anchored on the first
  // variant's column, which is where the table's comparison column reads it.
  for (const evaluator of state.evaluators) {
    const cfg = toComparisonConfig(evaluator);
    if (!cfg) continue;

    const resolution = resolveVariants(cfg, evaluator.id);
    if (resolution.skip) {
      const anchorId = anchorVariantId(cfg);
      if (anchorId) {
        pushSetupSkips({
          kind: resolution.skip,
          targetId: anchorId,
          evaluatorId: evaluator.id,
        });
      }
      continue;
    }
    const resolvedVariants = resolution.variants;

    const variantIds = buildVariantIdentifiers(resolvedVariants);
    const variantDisplayNames = buildVariantDisplayNames(resolvedVariants);
    const anchorVariant = resolvedVariants[0]!;

    for (const rowIndex of rowsInScope) {
      const datasetEntry = datasetRows[rowIndex];
      if (!datasetEntry) continue;

      const built = buildCandidates(
        cfg,
        resolvedVariants,
        variantIds,
        variantDisplayNames,
        rowIndex,
      );
      if (built.missing || built.empty) {
        skipReasons.push({
          rowIndex,
          targetId: anchorVariant.id,
          evaluatorId: evaluator.id,
          kind: built.missing ? "missing-output" : "empty-output",
          variantNames: built.missing ?? built.empty,
        });
        continue;
      }

      cells.push({
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
      });
    }
  }

  // Column-style comparison targets. Each is its own column whose verdict is
  // stored under TargetId=column-target.id rather than under a variant. A
  // synthetic EvaluatorConfig (from the target's comparison config +
  // targetEvaluatorId) gives buildEvaluatorInputs everything it needs.
  for (const target of state.targets) {
    if (target.type !== "evaluator") continue;
    const cfg = toComparisonConfig(target);
    if (!cfg || !target.targetEvaluatorId) continue;

    // Variant-count and golden-field gating (#5378) now live in
    // resolveVariants, shared with the chip-style loop above — a
    // column-target the user hasn't finished configuring (fewer than two
    // variants, or a golden field the settings claim but didn't pick) is
    // skipped the same way a chip-style comparison would be, rather than
    // hitting the judge endpoint and rendering a verdict-shaped 400 error.
    const resolution = resolveVariants(cfg, target.id);
    if (resolution.skip) {
      // A comparison COLUMN always has a cell to report into: its own.
      pushSetupSkips({
        kind: resolution.skip,
        targetId: target.id,
        evaluatorId: target.id,
      });
      continue;
    }
    const resolvedVariants = resolution.variants;

    const variantIds = buildVariantIdentifiers(resolvedVariants);
    const variantDisplayNames = buildVariantDisplayNames(resolvedVariants);

    // Resolved once per target (not per row): whether the DB evaluator this
    // column dispatches to is still the legacy 2-slot judge. See
    // isLegacyPairwiseBacked's JSDoc for why this can't just read
    // COMPARISON_EVALUATOR_TYPE off the target/cfg.
    const legacyPairwise =
      isLegacyPairwiseBacked(target.targetEvaluatorId) &&
      variantIds.length === 2;

    for (const rowIndex of rowsInScope) {
      const datasetEntry = datasetRows[rowIndex];
      if (!datasetEntry) continue;

      const built = buildCandidates(
        cfg,
        resolvedVariants,
        variantIds,
        variantDisplayNames,
        rowIndex,
      );
      if (built.missing || built.empty) {
        skipReasons.push({
          rowIndex,
          targetId: target.id,
          evaluatorId: target.id,
          kind: built.missing ? "missing-output" : "empty-output",
          variantNames: built.missing ?? built.empty,
        });
        continue;
      }

      // `input` falls back to the golden field for datasets with no literal
      // "input" column — a pre-existing convention (#5100) that predates the
      // golden-answer toggle. Since #5378 lets goldenField be undefined when
      // hasGoldenAnswer is off, that fallback is now a no-op for such rows;
      // log it so a silently-empty judge prompt is at least diagnosable
      // instead of indistinguishable from "row has no input, by design."
      const resolvedInput =
        (cfg.inputField ? datasetEntry[cfg.inputField] : undefined) ??
        datasetEntry.input ??
        (cfg.goldenField ? datasetEntry[cfg.goldenField] : undefined);
      if (
        resolvedInput === undefined &&
        !cfg.hasGoldenAnswer &&
        rowIndex === 0
      ) {
        logger.debug(
          { targetId: target.id },
          "Comparison column-target: no 'input' dataset column and no golden field to fall back on (has_golden_answer is off) — judge prompt will render an empty task/input",
        );
      }

      // Same #5378 gate buildEvaluatorInputs applies at runtime
      // (hasGoldenAnswer !== false && goldenField). Without it here too, a
      // legacy pairwise config folded in with hasGoldenAnswer false but a
      // stale non-empty goldenField (fromPairwise copies it verbatim) would
      // still bake a golden reference into this synthetic's static value
      // mapping while the runtime path correctly omits it — the two
      // disagreeing on the same config.
      const goldenValue =
        cfg.hasGoldenAnswer !== false && cfg.goldenField
          ? datasetEntry[cfg.goldenField]
          : undefined;

      // Per-row synthetic evaluator with PRE-RESOLVED value mappings for every
      // judge input. Pre-fix (#5131) the synthetic was shared across rows with
      // `mappings: {}`, leaving the candidate fields to be filled in by
      // buildEvaluatorInputs and propagated as manual inputs. That path
      // silently dropped them on the wire — the route's downstream
      // `getEvaluatorDataForParams` rebuilt `data` from the default schema,
      // stripping everything not value-mapped at build time. Embedding the
      // candidates as `value` mappings here means buildEvaluatorNode bakes
      // them into the workflow node's static inputs (and the mapping-branch
      // fallback in buildEvaluatorInputs sees them too), so they always reach
      // the judge regardless of which dispatch path is taken.
      //
      // The shape baked here must match whichever judge will ACTUALLY run —
      // the legacy 2-slot `candidate_a_id/output` + `candidate_b_id/output`
      // shape when `legacyPairwise`, or the N-way `candidates` shape
      // otherwise. See isLegacyPairwiseBacked's JSDoc for why the DB row,
      // not this cell's in-memory config, decides which judge runs.
      const [candidateA, candidateB] = built.candidates!.candidates;
      const perRowMappings: Record<
        string,
        Record<string, Record<string, { type: "value"; value: unknown }>>
      > = {
        [datasetId]: {
          [target.id]: legacyPairwise
            ? {
                candidate_a_id: { type: "value", value: variantIds[0] },
                candidate_a_output: {
                  type: "value",
                  value: candidateA?.output,
                },
                candidate_a_cost: { type: "value", value: candidateA?.cost },
                candidate_a_duration: {
                  type: "value",
                  value: candidateA?.duration,
                },
                candidate_b_id: { type: "value", value: variantIds[1] },
                candidate_b_output: {
                  type: "value",
                  value: candidateB?.output,
                },
                candidate_b_cost: { type: "value", value: candidateB?.cost },
                candidate_b_duration: {
                  type: "value",
                  value: candidateB?.duration,
                },
                input: { type: "value", value: resolvedInput },
                golden: { type: "value", value: goldenValue },
              }
            : {
                candidates: {
                  type: "value",
                  value: built.candidates!.candidates,
                },
                row_index: { type: "value", value: rowIndex },
                input: { type: "value", value: resolvedInput },
                golden: { type: "value", value: goldenValue },
              },
        },
      };

      const syntheticEvaluator = {
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
      } as unknown as EvaluatorConfig;

      cells.push({
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
        precomputedTargetOutput: built.candidates!.candidates[0]!.output,
        comparison: built.candidates,
      });
    }
  }

  return { cells, skipReasons };
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

/** What every evaluator of a cell is dispatched against. */
type CellEvaluatorContext = {
  cell: ExecutionCell;
  projectId: string;
  workflow: Workflow;
  targetOutput: Record<string, unknown>;
  traceId: string;
  targetNodes: Set<string>;
  config: ResultMapperConfig;
  isAborted?: () => Promise<boolean>;
};

/**
 * Dispatches one evaluator and yields whatever the engine reports back.
 *
 * The engine's events are collected before any of them is yielded, so a
 * dispatch that throws part-way through emits nothing and the caller reports a
 * single error cell instead of a half-written result.
 */
async function* runOneCellEvaluator({
  evaluatorId,
  evaluatorNodeId,
  cell,
  projectId,
  workflow,
  targetOutput,
  traceId,
  targetNodes,
  config,
  isAborted,
}: CellEvaluatorContext & {
  evaluatorId: string;
  evaluatorNodeId: string;
}): AsyncGenerator<EvaluationV3Event> {
  const evaluatorInputs = buildEvaluatorInputs(cell, evaluatorId, targetOutput);

  // The dispatch decision. An evaluator whose every input resolved empty is
  // not run: it would score empty against empty and report that as a verdict.
  const evaluator = cell.evaluatorConfigs.find((e) => e.id === evaluatorId);
  if (
    evaluator &&
    hasNoResolvedInputs({ cell, evaluator, inputs: evaluatorInputs })
  ) {
    logger.info(
      {
        rowIndex: cell.rowIndex,
        targetId: cell.targetId,
        evaluatorId,
        evaluatorType: evaluator.evaluatorType,
      },
      "Evaluator not dispatched: every input resolved empty",
    );
    yield noInputsResolvedResult({ cell, evaluator, evaluatorId });
    return;
  }

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

  const evaluatorEvents: StudioServerEvent[] = [];
  await studioBackendPostEvent({
    projectId,
    message: await addEnvs(evaluatorEvent, projectId),
    isAborted,
    onEvent: (serverEvent) => {
      evaluatorEvents.push(serverEvent);
    },
  });

  for (const event of evaluatorEvents) {
    const mappedEvent = mapNlpEvent({
      event,
      rowIndex: cell.rowIndex,
      targetNodes,
      config,
      evaluatorInputs,
    });
    if (mappedEvent) {
      yield mappedEvent;
    }
  }
}

/** The error cell an evaluator that could not run reports for itself. */
const evaluatorErrorResult = ({
  cell,
  evaluatorId,
  error,
}: {
  cell: ExecutionCell;
  evaluatorId: string;
  error: unknown;
}): EvaluationV3Event => ({
  type: "evaluator_result",
  rowIndex: cell.rowIndex,
  targetId: cell.targetId,
  evaluatorId,
  result: {
    status: "error",
    error_type: "EvaluatorError",
    details:
      error instanceof Error ? error.message : "Evaluator execution failed",
    traceback: [],
    ...(HandledError.isHandled(error)
      ? { domainError: error.serialize() }
      : {}),
  },
});

/**
 * Dispatches a cell's grading evaluators against the target's output.
 *
 * Shared by both executors. A prompt or component target runs as one node of a
 * mini-workflow; a workflow target runs its whole Studio graph. Either way the
 * evaluators attached to the column are the same evaluators, dispatched one at
 * a time with explicit inputs, so this is all the two have in common and all
 * they need to share.
 *
 * One evaluator failing does not stop the rest: each reports its own error
 * cell, and the target's own result is already yielded by the time this runs.
 */
async function* runCellEvaluators({
  evaluatorNodeIds,
  ...context
}: CellEvaluatorContext & {
  evaluatorNodeIds: Record<string, string>;
}): AsyncGenerator<EvaluationV3Event> {
  const { cell, isAborted } = context;

  for (const [evaluatorId, evaluatorNodeId] of Object.entries(
    evaluatorNodeIds,
  )) {
    if (isAborted && (await isAborted())) {
      logger.debug(
        { cell: cell.rowIndex, evaluatorId },
        "Cell aborted before evaluator execution",
      );
      return;
    }
    try {
      yield* runOneCellEvaluator({ ...context, evaluatorId, evaluatorNodeId });
    } catch (evalError) {
      logger.warn(
        {
          error: evalError,
          evaluatorId,
          rowIndex: cell.rowIndex,
          targetId: cell.targetId,
        },
        "Evaluator execution failed",
      );
      yield evaluatorErrorResult({ cell, evaluatorId, error: evalError });
    }
  }
}

/**
 * Whether any target this run executes puts Python in a sandbox, which is the
 * only thing the agent cache credential is for.
 */
function runExecutesCode({
  loadedAgents,
  loadedWorkflows,
}: {
  loadedAgents: Map<string, TypedAgent>;
  loadedWorkflows?: Map<string, LoadedWorkflow>;
}): boolean {
  for (const agent of loadedAgents.values()) {
    if (agent.type === "code") return true;
  }
  for (const workflow of loadedWorkflows?.values() ?? []) {
    if (workflow.dsl.nodes.some((node) => node.type === "code")) return true;
  }
  return false;
}

/**
 * The credential every code node of this run authenticates with, or undefined.
 *
 * One key for the whole run, and the same key the project's other runs hold:
 * every row shares the cache entries the run writes, and a key per row or per
 * run would leave a ledger of live credentials behind. A run that cannot get
 * one still runs, and every row does its own work.
 */
async function mintRunSandboxApiKey({
  projectId,
  loadedAgents,
  loadedWorkflows,
}: {
  projectId: string;
  loadedAgents: Map<string, TypedAgent>;
  loadedWorkflows?: Map<string, LoadedWorkflow>;
}): Promise<string | undefined> {
  if (!runExecutesCode({ loadedAgents, loadedWorkflows })) return undefined;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { team: { select: { organizationId: true } } },
  });
  const organizationId = project?.team?.organizationId;
  if (!organizationId) return undefined;

  return tryGetAgentSandboxApiKey({ prisma, projectId, organizationId });
}

/**
 * Sets the run's sandbox credential on an event's workflow.
 *
 * Applied after `addEnvs` rather than inside it: `addEnvs` is shared by about
 * ten callers and knows nothing about a run, so widening it would put a
 * credential on events that have no run behind them. A one-off Studio run
 * therefore carries no key, and every row of it does its own work.
 */
function withSandboxApiKey(
  event: StudioClientEvent,
  sandboxApiKey: string | undefined,
): StudioClientEvent {
  const { payload } = event;
  if (!sandboxApiKey || !("workflow" in payload)) return event;
  // The cast is what every writer of this union does: spreading one member of
  // a discriminated union widens the payload back to the union, and there is
  // no narrowing that survives the spread. `addEnvs` returns the same shape
  // the same way.
  return {
    ...event,
    payload: {
      ...payload,
      workflow: { ...payload.workflow, sandbox_api_key: sandboxApiKey },
    },
  } as StudioClientEvent;
}

/**
 * Executes a single cell and yields events.
 * @param isAborted - Optional function to check if execution should be aborted
 */
export async function* executeCell(
  cell: ExecutionCell,
  projectId: string,
  datasetColumns: Array<{ id: string; name: string; type: string }>,
  loadedData: {
    prompt?: VersionedPrompt;
    agent?: TypedAgent;
    evaluators?: Map<string, { id: string; name: string; config: unknown }>;
    /** The run's agent cache credential, when it minted one. */
    sandboxApiKey?: string;
  },
  resultMapperConfig?: ResultMapperConfig,
  isAborted?: () => Promise<boolean>,
): AsyncGenerator<EvaluationV3Event> {
  // Emit cell_started
  yield {
    type: "cell_started",
    rowIndex: cell.rowIndex,
    targetId: cell.targetId,
  };

  try {
    // The dispatch decision for an evaluator COLUMN. Nothing mapped means
    // nothing to score, and scoring empty against empty passes.
    if (
      evaluatorTargetHasNoResolvedInputs({
        cell,
        loadedEvaluators: loadedData.evaluators,
      })
    ) {
      const name = evaluatorTargetDisplayName({
        target: cell.targetConfig,
        loadedEvaluators: loadedData.evaluators,
      });
      logger.info(
        { rowIndex: cell.rowIndex, targetId: cell.targetId, name },
        "Evaluator column not dispatched: every input resolved empty",
      );
      yield evaluatorTargetNoInputsResult({ cell, name });
      return;
    }

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

    let targetOutput: Record<string, unknown> | undefined;
    let targetFailed = false;

    // If skipTarget is true, use pre-computed output instead of executing target
    if (cell.skipTarget && cell.precomputedTargetOutput !== undefined) {
      logger.debug(
        { rowIndex: cell.rowIndex, targetId: cell.targetId },
        "Skipping target execution, using pre-computed output",
      );
      // Convert precomputedTargetOutput to the expected format
      // The target output should be a record with the output field identifier as key
      if (
        typeof cell.precomputedTargetOutput === "object" &&
        cell.precomputedTargetOutput !== null
      ) {
        targetOutput = cell.precomputedTargetOutput as Record<string, unknown>;
      } else {
        // If it's a primitive value, wrap it in the expected output field
        const outputField =
          cell.targetConfig.outputs?.[0]?.identifier ?? "output";
        targetOutput = { [outputField]: cell.precomputedTargetOutput };
      }
    } else {
      // Execute target normally
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
      const enrichedEvent = withSandboxApiKey(
        await loadDatasets(await addEnvs(rawEvent, projectId), projectId),
        loadedData.sandboxApiKey,
      );

      // Execute target and collect events
      const targetEvents: StudioServerEvent[] = [];

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
    }

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
      yield* runCellEvaluators({
        cell,
        projectId,
        workflow,
        evaluatorNodeIds,
        targetOutput,
        traceId,
        targetNodes,
        config: cellConfig,
        isAborted,
      });
    }
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
  datasetColumns = [],
  loadedEvaluators,
  resultMapperConfig,
  isAborted,
  sandboxApiKey,
}: {
  cell: ExecutionCell;
  projectId: string;
  workflowDsl: Workflow;
  datasetColumns?: Array<{ id: string; name: string; type: string }>;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  resultMapperConfig?: ResultMapperConfig;
  isAborted?: () => Promise<boolean>;
  /** The run's agent cache credential, when it minted one. */
  sandboxApiKey?: string;
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

    const rawEvent = {
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
    };

    const enrichedEvent = withSandboxApiKey(
      await loadDatasets(await addEnvs(rawEvent, projectId), projectId),
      sandboxApiKey,
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

    let targetOutput: unknown;
    /**
     * The end node's results as a record, before extractTargetOutput unwraps a
     * lone "output" into a bare value. This is what an evaluator maps against,
     * so a mapping to any other result — "chunks", "citations" — still resolves.
     */
    let targetOutputRecord: Record<string, unknown> | undefined;
    let totalCost = 0;
    let sawCost = false;
    let targetFailed = false;
    /**
     * The failing state, captured whole.
     *
     * One assignment, not three latches: message, code and upstream status
     * describe ONE failure. Latching them independently (`ex.error ?? previous`
     * and so on) let a state carrying only `error` be followed by one carrying
     * only `error_type`, yielding a `domainError` whose code came from one node
     * and whose message came from another.
     */
    let targetFailure:
      | { error?: string; errorType?: string; upstreamStatus?: number }
      | undefined;
    let durationMs: number | undefined;
    let finalTraceId = traceId;
    const evaluatorEvents: EvaluationV3Event[] = [];

    for (const event of events) {
      if (event.type === "execution_state_change") {
        const ex = event.payload.execution_state;
        if (ex?.result !== undefined) {
          targetOutput = extractTargetOutput(ex.result);
          targetOutputRecord = ex.result;
        }
        if (ex?.trace_id) finalTraceId = ex.trace_id;
        if (
          ex?.timestamps?.started_at !== undefined &&
          ex?.timestamps?.finished_at !== undefined
        ) {
          durationMs = ex.timestamps.finished_at - ex.timestamps.started_at;
        }
        if (ex?.status === "error") {
          targetFailed = true;
          targetFailure = {
            error: ex.error,
            errorType: ex.error_type,
            upstreamStatus: ex.upstream_status,
          };
        }
        continue;
      }

      if (event.type !== "component_state_change") continue;
      const { component_id, execution_state } = event.payload;
      if (!execution_state) continue;

      if (
        typeof execution_state.cost === "number" &&
        execution_state.cost > 0
      ) {
        totalCost += execution_state.cost;
        sawCost = true;
      } else {
        // LLM nodes report tokens but no cost (the engine has no price table),
        // so price them at the canonical model rate, same as executeCell.
        const cost = await priceMetrics(projectId, execution_state.metrics);
        if (cost != null) {
          totalCost += cost;
          sawCost = true;
        }
      }

      if (
        evaluatorNodeNames.has(component_id) &&
        (execution_state.status === "success" ||
          execution_state.status === "error")
      ) {
        evaluatorEvents.push(
          mapWorkflowEvaluatorResult(
            cell.rowIndex,
            cell.targetId,
            component_id,
            evaluatorNodeNames.get(component_id),
            {
              status: execution_state.status,
              outputs: execution_state.outputs,
              cost: execution_state.cost,
              error: execution_state.error,
              // The coded half of the failure — without it the evaluator cell
              // renders the engine's raw message verbatim.
              nodeErrorCode: execution_state.error_type,
              upstream_status: execution_state.upstream_status,
              trace_id: execution_state.trace_id ?? finalTraceId,
            },
          ),
        );
      }
    }

    // Yield the target result first so storage links evaluator results to it.
    yield {
      type: "target_result",
      rowIndex: cell.rowIndex,
      targetId: cell.targetId,
      output: targetOutput,
      cost: sawCost ? totalCost : undefined,
      duration: durationMs,
      traceId: finalTraceId,
      // The engine's own words when it gave any; otherwise the marker, so the
      // client's fallback copy owns what the customer reads rather than a
      // sentence written here.
      error: targetFailed
        ? (targetFailure?.error ?? UNNAMED_FAILURE)
        : undefined,
      ...(targetFailed && targetFailure?.errorType
        ? {
            domainError: nodeErrorToDomainError({
              errorType: targetFailure.errorType,
              message: targetFailure.error,
              upstreamStatus: targetFailure.upstreamStatus,
              traceId: finalTraceId,
            }),
          }
        : {}),
    };

    for (const evaluatorEvent of evaluatorEvents) {
      yield evaluatorEvent;
    }

    // The evaluators attached to this column in the workbench, which are not
    // part of the workflow and so did not run with it. Only reached when the
    // workflow produced a result: grading a row that never produced one would
    // score the absence of an answer rather than an answer.
    if (
      !targetFailed &&
      targetOutputRecord &&
      cell.evaluatorConfigs.length > 0
    ) {
      const { workflow, evaluatorNodeIds } = buildEvaluatorCellWorkflow({
        projectId,
        cell,
        datasetColumns,
        loadedEvaluators,
      });
      yield* runCellEvaluators({
        cell,
        projectId,
        workflow,
        evaluatorNodeIds,
        targetOutput: targetOutputRecord,
        traceId: finalTraceId,
        targetNodes: new Set([cell.targetId]),
        config: resultMapperConfig ?? {},
        isAborted,
      });
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

/** One turn to a connected agent, as the cell executor asks for it. */
export type ConnectedDispatch = (params: {
  projectId: string;
  agent: DispatchAgent;
  call: DispatchCall;
  signal: AbortSignal;
}) => Promise<CallOutcome>;

/** The runtime's own dispatcher, which is what a real run uses. */
const relayDispatch: ConnectedDispatch = (params) =>
  getConnectedAgentRuntime().dispatcher.dispatch(params);

/**
 * The agent as the dispatcher reads it, with the per-call budget capped the
 * same way the relay route caps it. One agent, one contract: a column may not
 * ask for a longer call than a REST caller can.
 */
const dispatchAgentOf = (agent: TypedAgent): DispatchAgent => {
  const config = agent.config as ConnectedComponentConfig;
  return {
    id: agent.id,
    name: agent.name,
    environment: agent.environment ?? null,
    timeoutMs: Math.min(
      config.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
      MAX_CALL_TIMEOUT_MS,
    ),
    // A workbench row is a conversation of one turn, so there is nothing to
    // pin: every row picks whichever instance is free.
    isSticky: false,
  };
};

/**
 * The one turn a row sends: the mapped row as a single user message, in its
 * own conversation and inside the trace of the cell.
 */
const connectedTurnParams = ({
  cell,
  projectId,
  agent,
  dispatchAgent,
  traceId,
}: {
  cell: ExecutionCell;
  projectId: string;
  agent: TypedAgent;
  dispatchAgent: ReturnType<typeof dispatchAgentOf>;
  traceId: string;
}): Omit<Parameters<ConnectedDispatch>[0], "signal"> => {
  const { messages, params } = buildConnectedCall({
    inputs: buildTargetInputs(cell),
    definitions: connectedParameterDefinitions(agent.config),
  });
  return {
    projectId,
    agent: dispatchAgent,
    call: {
      // One row, one conversation. The cell's own trace id keeps it unique
      // and ties the conversation to the row that started it.
      threadId: `eval_v3_${cell.rowIndex}_${traceId}`,
      messages,
      newMessages: messages.slice(-1),
      params,
      session: undefined,
      // The agent adopts this context, so the spans it records land in the
      // cell's own trace and the row links straight to them.
      traceparent: `00-${traceId}-${generateOtelSpanId()}-01`,
      run: {},
    },
  };
};

/**
 * What the cell shows when the turn did not answer.
 *
 * A named failure keeps its code, so the cell renders the copy of that code
 * instead of a generic unknown error.
 */
const connectedFailureEvent = ({
  cell,
  projectId,
  agentId,
  error,
  traceId,
  duration,
}: {
  cell: ExecutionCell;
  projectId: string;
  agentId: string;
  error: unknown;
  traceId: string;
  duration: number;
}): EvaluationV3Event => {
  logger.info(
    {
      error,
      projectId,
      agentId,
      rowIndex: cell.rowIndex,
      targetId: cell.targetId,
    },
    "Connected agent cell failed",
  );
  const failure = connectedCallFailure(error);
  return {
    type: "target_result",
    rowIndex: cell.rowIndex,
    targetId: cell.targetId,
    output: undefined,
    duration,
    traceId,
    error: failure.message,
    ...(failure.domainError ? { domainError: failure.domainError } : {}),
  };
};

/** What one connected agent cell needs to run. */
interface ConnectedCellInput {
  cell: ExecutionCell;
  projectId: string;
  agent: TypedAgent;
  datasetColumns?: Array<{ id: string; name: string; type: string }>;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  resultMapperConfig?: ResultMapperConfig;
  isAborted?: () => Promise<boolean>;
  /** The dispatcher the turn goes through, replaceable in tests. */
  dispatch?: ConnectedDispatch;
  /** The wait between busy retries, replaceable in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** The clock the retry budget reads, replaceable in tests. */
  now?: () => number;
}

/**
 * Executes a single cell whose target is a connected agent.
 *
 * The agent runs in the customer's own process, so the engine has no node for
 * it: the row is one turn through the relay dispatcher (ADR-128), sent from
 * here and answered in place. The evaluators attached to the column then run
 * exactly as they do for a workflow target, over the text the agent answered.
 *
 * Each row is its own conversation. A workbench row has no history to carry,
 * so it sends one user message under its own thread id and keeps no session:
 * what one row said can never reach another.
 */
export async function* executeConnectedCell({
  cell,
  projectId,
  agent,
  datasetColumns = [],
  loadedEvaluators,
  resultMapperConfig,
  isAborted,
  dispatch = relayDispatch,
  sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
}: ConnectedCellInput): AsyncGenerator<EvaluationV3Event> {
  yield {
    type: "cell_started",
    rowIndex: cell.rowIndex,
    targetId: cell.targetId,
  };

  const traceId = cell.traceId ?? generateOtelTraceId();
  const dispatchAgent = dispatchAgentOf(agent);
  const startedAt = now();

  let outcome: CallOutcome;
  try {
    outcome = await dispatchWithBusyRetry({
      dispatch,
      sleep,
      now,
      isAborted,
      budgetEndsAt: startedAt + CONNECTED_BUSY_RETRY_BUDGET_MS,
      callTimeoutMs: dispatchAgent.timeoutMs + CONNECTED_REQUEST_SLACK_MS,
      params: connectedTurnParams({
        cell,
        projectId,
        agent,
        dispatchAgent,
        traceId,
      }),
    });
  } catch (error) {
    yield connectedFailureEvent({
      cell,
      projectId,
      agentId: agent.id,
      error,
      traceId,
      duration: now() - startedAt,
    });
    return;
  }

  const output = connectedOutputText(outcome.output);

  yield {
    type: "target_result",
    rowIndex: cell.rowIndex,
    targetId: cell.targetId,
    output,
    // The whole cell, not only the call that answered: a row that waited out
    // a busy agent took that time too, and a run comparison reads it.
    duration: now() - startedAt,
    traceId,
  };

  if (cell.evaluatorConfigs.length === 0) return;

  const { workflow, evaluatorNodeIds } = buildEvaluatorCellWorkflow({
    projectId,
    cell,
    datasetColumns,
    loadedEvaluators,
  });
  yield* runCellEvaluators({
    cell,
    projectId,
    workflow,
    evaluatorNodeIds,
    targetOutput: { [CONNECTED_OUTPUT_FIELD]: output },
    traceId,
    targetNodes: new Set([cell.targetId]),
    config: resultMapperConfig ?? {},
    isAborted,
  });
}

/**
 * One turn, waiting out a busy agent.
 *
 * Every instance being full is a queue, not a failure: the platform says when
 * to try again and the row waits, the same way a simulation turn does. The
 * budget bounds it so a permanently full agent still fails the row rather
 * than holding a slot of the run forever.
 */
const dispatchWithBusyRetry = async ({
  dispatch,
  params,
  sleep,
  now,
  isAborted,
  budgetEndsAt,
  callTimeoutMs,
}: {
  dispatch: ConnectedDispatch;
  params: Omit<Parameters<ConnectedDispatch>[0], "signal">;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  isAborted?: () => Promise<boolean>;
  budgetEndsAt: number;
  callTimeoutMs: number;
}): Promise<CallOutcome> => {
  for (;;) {
    try {
      // Every attempt gets its own deadline. One shared signal would carry
      // the time the earlier attempts and their waits already spent, so an
      // agent that declares a timeout shorter than the retry budget would
      // abort a later attempt the moment it starts.
      return await dispatch({
        ...params,
        signal: AbortSignal.timeout(callTimeoutMs),
      });
    } catch (error) {
      const retryAfterMs = busyRetryAfterMs(error);
      if (retryAfterMs === undefined || now() >= budgetEndsAt) throw error;
      // A stopped run waits for nothing: the row fails now rather than
      // holding a slot of the run for the rest of the budget.
      if (isAborted && (await isAborted())) throw error;
      // Jitter spreads the retries of the rows that hit a full agent at once.
      const waitMs = Math.min(
        retryAfterMs + Math.floor(Math.random() * retryAfterMs),
        budgetEndsAt - now(),
      );
      await sleep(Math.max(0, waitMs));
    }
  }
};

/** How long a busy agent asked to be left alone, or nothing if it is not busy. */
const busyRetryAfterMs = (error: unknown): number | undefined => {
  if (!(error instanceof AgentBusyError)) return undefined;
  const declared = error.meta?.retryAfterMs;
  return typeof declared === "number" && declared > 0
    ? declared
    : BUSY_RETRY_AFTER_MS;
};

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
  const inputs: Record<string, unknown> = {};
  const datasetId = cell.datasetEntry._datasetId as string | undefined;
  if (!datasetId) return inputs;

  // Find the evaluator config
  const evaluator = cell.evaluatorConfigs.find((e) => e.id === evaluatorId);
  if (!evaluator) return inputs;

  // Comparison branch: synthetic inputs bypassing the per-target mapping
  // system. We know explicitly where each field comes from (golden ->
  // dataset[goldenField]; candidates -> cell.comparison), so we assemble them
  // directly. `input` still reuses the first variant's existing mapping when
  // one is configured, so dataset-side input renaming keeps working;
  // otherwise it falls back to the dataset's `input` column.
  const comparisonConfig = toComparisonConfig(evaluator);
  if (comparisonConfig && cell.comparison) {
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
      const [candidateA, candidateB] = cell.comparison.candidates;
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
    } else {
      inputs.candidates = cell.comparison.candidates.map((c) => ({
        id: c.id,
        output: c.output,
        cost: c.cost,
        duration: c.duration,
      }));
      // Seeds the judge's deterministic candidate shuffle (randomize_order).
      inputs.row_index = cell.rowIndex;
    }

    // Defensive fallback: if a candidate value was lost between cell creation
    // and here, pull it from the per-row synthetic value mappings that
    // generateComparisonCells bakes onto column-target cells (#5131). Strictly
    // additive — only fires for fields the primary read left undefined.
    const cellMappings = evaluator.mappings[datasetId]?.[cell.targetId] ?? {};
    for (const [field, mapping] of Object.entries(cellMappings)) {
      if (
        mapping.type === "value" &&
        mapping.value !== undefined &&
        inputs[field] === undefined
      ) {
        inputs[field] = mapping.value;
      }
    }

    return inputs;
  }

  // Get mappings for this dataset and target
  const mappings = evaluator.mappings[datasetId]?.[cell.targetId] ?? {};

  for (const [inputField, mapping] of Object.entries(mappings)) {
    if (mapping.type === "source") {
      if (mapping.source === "dataset") {
        // From dataset entry - uses column name as key
        inputs[inputField] = cell.datasetEntry[mapping.sourceField];
      } else if (
        mapping.source === "target" &&
        mapping.sourceId === cell.targetId
      ) {
        // From target output
        inputs[inputField] = targetOutput[mapping.sourceField];
      }
    } else if (mapping.type === "value") {
      inputs[inputField] = mapping.value;
    }
  }

  return inputs;
};

/** The `error_type` a row carries when an evaluator resolved no input at all. */
export const NO_INPUTS_RESOLVED = "NoInputsResolved";

/** A resolved value that carries nothing for the evaluator to read. */
const isEmptyInputValue = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "");

/**
 * A type's fields from the catalog, required plus optional. Optional counts —
 * an evaluator whose only field is optional is just as broken when that field
 * is unmapped as one whose field is required.
 */
const catalogFields = (evaluatorType: string | undefined): string[] => {
  const definition = AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes];
  return [
    ...(definition?.requiredFields ?? []),
    ...(definition?.optionalFields ?? []),
  ];
};

/**
 * The fields an evaluator reads: the ones declared on its own config, and the
 * catalog's otherwise.
 */
const declaredEvaluatorFields = (evaluator: EvaluatorConfig): string[] => {
  const declared = evaluator.inputs?.map((field) => field.identifier) ?? [];
  if (declared.length > 0) return declared;
  return catalogFields(evaluator.evaluatorType);
};

/** What the row calls the evaluator that could not run. */
const evaluatorDisplayName = (evaluator: EvaluatorConfig): string =>
  AVAILABLE_EVALUATORS[evaluator.evaluatorType as EvaluatorTypes]?.name ??
  evaluator.evaluatorType;

/** DB evaluator rows a run has loaded, keyed by their own id. */
type LoadedEvaluators = Map<
  string,
  { id: string; name: string; config: unknown }
>;

/**
 * The fields an evaluator COLUMN reads. Its own declared inputs when it has
 * them; otherwise the catalog fields of the DB evaluator behind it, whose type
 * only the loaded row knows (a target carries the evaluator's id, not its type).
 */
const evaluatorTargetFields = ({
  target,
  loadedEvaluators,
}: {
  target: TargetConfig;
  loadedEvaluators?: LoadedEvaluators;
}): string[] => {
  const declared = target.inputs?.map((field) => field.identifier) ?? [];
  if (declared.length > 0) return declared;
  const dbConfig = loadedEvaluators?.get(target.targetEvaluatorId ?? "")
    ?.config as { evaluatorType?: string } | undefined;
  return catalogFields(dbConfig?.evaluatorType);
};

/** What the row calls the evaluator column that could not run. */
export const evaluatorTargetDisplayName = ({
  target,
  loadedEvaluators,
}: {
  target: TargetConfig;
  loadedEvaluators?: LoadedEvaluators;
}): string =>
  target.localEvaluatorConfig?.name ??
  loadedEvaluators?.get(target.targetEvaluatorId ?? "")?.name ??
  target.id;

/**
 * Whether dispatching this evaluator COLUMN would hand it nothing to read.
 *
 * The chip guard above covers evaluators attached to a target; a column whose
 * target IS an evaluator dispatches through `buildTargetInputs` instead and
 * needs the same answer, for the same reason: `exact_match` comparing "" to ""
 * reports a pass, and that pass is counted in the run's pass rate.
 *
 * A comparison column is exempt — its payload is the candidate list Phase 2
 * builds, not the cell's mappings. So is a cell running a precomputed output,
 * which dispatches no target at all.
 */
export const evaluatorTargetHasNoResolvedInputs = ({
  cell,
  loadedEvaluators,
}: {
  cell: ExecutionCell;
  loadedEvaluators?: LoadedEvaluators;
}): boolean => {
  const target = cell.targetConfig;
  if (target.type !== "evaluator") return false;
  if (cell.comparison || cell.skipTarget) return false;

  const fields = evaluatorTargetFields({ target, loadedEvaluators });
  if (fields.length === 0) return false;

  return Object.values(buildTargetInputs(cell)).every(isEmptyInputValue);
};

/** The error cell an evaluator column with nothing mapped reports for itself. */
const evaluatorTargetNoInputsResult = ({
  cell,
  name,
}: {
  cell: ExecutionCell;
  name: string;
}): EvaluationV3Event => ({
  type: "target_result",
  rowIndex: cell.rowIndex,
  targetId: cell.targetId,
  output: undefined,
  domainError: new EvaluatorNoInputsResolvedError(name).serialize(),
});

/**
 * Whether dispatching would hand the evaluator nothing to read.
 *
 * An evaluator that declares fields and resolves every one of them empty
 * cannot produce a verdict, but it does produce a RESULT: `exact_match`
 * compares "" to "" and reports a pass, and that pass is counted in the run's
 * pass rate. The row reports the unmapped fields instead of running.
 *
 * A comparison cell is exempt. `buildCandidates` refuses to build a cell whose
 * candidates carry no text and reports the missing or empty variants with its
 * own error, so the payload is resolved as long as one candidate has text.
 */
export const hasNoResolvedInputs = ({
  cell,
  evaluator,
  inputs,
}: {
  cell: ExecutionCell;
  evaluator: EvaluatorConfig;
  inputs: Record<string, unknown>;
}): boolean => {
  if (cell.comparison && toComparisonConfig(evaluator)) {
    return !cell.comparison.candidates.some(
      (candidate) => !isEmptyInputValue(candidate.output),
    );
  }

  // An evaluator that declares no field reads nothing from the row, so there is
  // nothing to be missing.
  if (declaredEvaluatorFields(evaluator).length === 0) return false;

  // An empty payload is the shape the production failure takes: no mapping
  // resolved, so no key was ever written.
  return Object.values(inputs).every(isEmptyInputValue);
};

/** The error row an evaluator with nothing mapped reports for itself. */
const noInputsResolvedResult = ({
  cell,
  evaluator,
  evaluatorId,
}: {
  cell: ExecutionCell;
  evaluator: EvaluatorConfig;
  evaluatorId: string;
}): EvaluationV3Event => ({
  type: "evaluator_result",
  rowIndex: cell.rowIndex,
  targetId: cell.targetId,
  evaluatorId,
  result: {
    status: "error",
    error_type: NO_INPUTS_RESOLVED,
    details: `${evaluatorDisplayName(
      evaluator,
    )} received no input for this row. Map its fields in the evaluator settings, then run again.`,
    traceback: [],
    domainError: new EvaluatorNoInputsResolvedError(
      evaluatorDisplayName(evaluator),
    ).serialize(),
  },
});

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
  targets.map((t) => {
    let model: string | null = null;
    let name: string | null = null;

    // First check local prompt config (for edited prompts)
    if (t.localPromptConfig?.llm?.model) {
      model = t.localPromptConfig.llm.model;
    }
    // Otherwise, check loaded prompts (for saved prompts)
    else if (t.type === "prompt" && t.promptId) {
      const loadedPrompt = loadedPrompts.get(promptLoadKey(t));
      if (loadedPrompt?.model) {
        model = loadedPrompt.model;
      }
    }
    // Evaluator targets — the judge. Recorded onto the run for the same
    // reason a prompt target's model is: the evaluator's config can be
    // edited afterwards, and reading it live would retroactively
    // misattribute every historical run to whatever model is configured
    // today. The leaderboard's self-preference check depends on knowing
    // which model actually judged, so a wrong answer here is worse than
    // none.
    else if (t.type === "evaluator" && t.targetEvaluatorId) {
      // Unsaved edits first, exactly as the prompt branch above does and as
      // `workflowBuilder` does when it decides what to actually RUN. Reading
      // only the saved config meant a user who switched the judge model
      // without saving ran on one model and recorded the other — and the
      // recorded one is what feeds the leaderboard's self-preference check,
      // so it would report independence from a model that never judged.
      const settings =
        (
          t.localEvaluatorConfig as
            | { settings?: { model?: unknown } }
            | undefined
        )?.settings ??
        (
          loadedEvaluators?.get(t.targetEvaluatorId)?.config as
            | { settings?: { model?: unknown } }
            | undefined
        )?.settings;
      if (typeof settings?.model === "string" && settings.model) {
        model = settings.model;
      }
    }

    // Get name from loaded entity
    if (t.type === "prompt" && t.promptId) {
      name = loadedPrompts.get(promptLoadKey(t))?.name ?? null;
    } else if (t.type === "agent" && t.dbAgentId) {
      name = loadedAgents.get(t.dbAgentId)?.name ?? null;
    } else if (t.type === "evaluator" && t.targetEvaluatorId) {
      name = loadedEvaluators?.get(t.targetEvaluatorId)?.name ?? null;
    } else if (t.type === "workflow" && t.workflowId) {
      name = loadedWorkflows?.get(workflowLoadKey(t))?.name ?? null;
    }

    return {
      id: t.id,
      name: name ?? t.id,
      type: t.type,
      prompt_id: t.promptId ?? null,
      prompt_version: t.promptVersionNumber ?? null,
      agent_id: t.dbAgentId ?? null,
      evaluator_id: t.targetEvaluatorId ?? null,
      model,
    };
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
    return {
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
    };
  }

  if (
    event.type === "error" &&
    event.rowIndex !== undefined &&
    event.targetId
  ) {
    return {
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
    };
  }

  return null;
};

/**
 * Build the recordEvaluatorResult dispatch payload for an `evaluator_result`
 * event.
 *
 * Exported for unit testing, because what a non-processed result may carry is
 * regression-prone: a score, a label, a verdict and a pass/fail all belong to
 * an evaluation that actually scored, but the money does not. An evaluation
 * that declines to score can still have spent it, and the comparison judge
 * pays for both of its passes before finding they disagree, which makes a row
 * with no winner the most expensive kind of row there is.
 */
export const buildEvaluatorResultDispatch = ({
  tenantId,
  runId,
  experimentId,
  event,
  result,
  evaluatorName,
  occurredAt,
}: {
  tenantId: string;
  runId: string;
  experimentId: string;
  event: {
    rowIndex: number;
    targetId: string;
    evaluatorId: string;
    duration?: number | null;
    inputs?: Record<string, unknown> | null;
  };
  result: SingleEvaluationResult;
  evaluatorName: string | null;
  occurredAt: number;
}): RecordEvaluatorResultCommandData => {
  // Only an evaluation that actually scored has a verdict to report.
  const scored = result.status === "processed" ? result : null;
  // An error measured nothing and spent nothing; the other two statuses may
  // have spent without scoring.
  const billed = result.status === "error" ? null : result;

  return {
    tenantId,
    runId,
    experimentId,
    index: event.rowIndex,
    targetId: event.targetId,
    evaluatorId: event.evaluatorId,
    evaluatorName,
    status: result.status,
    score: scored?.score ?? null,
    label: scored?.label ?? null,
    passed: scored?.passed ?? null,
    details: result.status === "skipped" ? null : (result.details ?? null),
    cost: billed?.cost?.amount ?? null,
    inputs: event.inputs ?? null,
    duration: event.duration ?? null,
    occurredAt,
  };
};

/**
 * The optional halves of a carried cell, each present only when the board
 * holds it. An absent cost is not a zero cost, and an absent trace is not a
 * missing one.
 */
const carriedCellFields = (cell: CarriedOverCell) => ({
  ...(cell.cost !== undefined ? { cost: cell.cost } : {}),
  ...(cell.duration !== undefined ? { duration: cell.duration } : {}),
  ...(cell.traceId !== undefined ? { traceId: cell.traceId } : {}),
  ...(cell.error !== undefined ? { error: cell.error } : {}),
  ...(cell.domainError !== undefined ? { domainError: cell.domainError } : {}),
});

/** The statuses the store knows. A verdict with any other is dropped. */
const isStorableVerdict = (
  result: SingleEvaluationResult | undefined,
): result is SingleEvaluationResult =>
  result?.status === "processed" ||
  result?.status === "error" ||
  result?.status === "skipped";

/**
 * The target row a carried cell contributes, or null when it holds none.
 *
 * A cell with neither an output nor a failure gets no row: writing one would
 * say the column produced nothing, which reads as a result rather than as an
 * empty cell.
 */
const carriedTargetResult = ({
  tenantId,
  runId,
  experimentId,
  cell,
  datasetEntry,
  occurredAt,
}: {
  tenantId: string;
  runId: string;
  experimentId: string;
  cell: CarriedOverCell;
  datasetEntry: Record<string, unknown>;
  occurredAt: number;
}): RecordTargetResultCommandData | null => {
  const hasOutput = cell.output !== undefined && cell.output !== null;
  if (!hasOutput && !cell.error) return null;

  const dispatch = buildTargetResultDispatch({
    tenantId,
    runId,
    experimentId,
    event: {
      type: "target_result",
      rowIndex: cell.rowIndex,
      targetId: cell.targetId,
      output: cell.output,
      ...carriedCellFields(cell),
    },
    datasetEntry,
    occurredAt,
  });

  return dispatch ? { ...dispatch, carriedOver: true } : null;
};

/** The verdict rows a carried cell contributes, in board order. */
const carriedEvaluatorResults = ({
  tenantId,
  runId,
  experimentId,
  cell,
  evaluatorNameFor,
  occurredAt,
}: {
  tenantId: string;
  runId: string;
  experimentId: string;
  cell: CarriedOverCell;
  evaluatorNameFor: (evaluatorId: string) => string | null;
  occurredAt: number;
}): RecordEvaluatorResultCommandData[] =>
  cell.evaluatorResults.flatMap((verdict) => {
    const result = verdict.result as SingleEvaluationResult | undefined;
    if (!isStorableVerdict(result)) return [];

    return [
      {
        ...buildEvaluatorResultDispatch({
          tenantId,
          runId,
          experimentId,
          event: {
            rowIndex: cell.rowIndex,
            targetId: cell.targetId,
            evaluatorId: verdict.evaluatorId,
          },
          result,
          evaluatorName: evaluatorNameFor(verdict.evaluatorId),
          occurredAt,
        }),
        carriedOver: true,
      },
    ];
  });

/**
 * The stored rows for the board cells a run carries rather than produces.
 *
 * A run holds a snapshot of the whole board, so opening it shows what the
 * person was looking at instead of the one column they clicked. The cells
 * outside the execution scope are copied in at run start; the cells inside it
 * fill in as they execute.
 *
 * Built through the same two dispatch builders a live cell goes through, so a
 * carried cell and a produced cell are the same row in every respect but one:
 * `carriedOver`. That flag is what keeps the run's cost, duration and progress
 * about the run's own work. Money and time belong to this run; verdicts and
 * scores belong to the board.
 *
 * A cell with neither an output nor a failure gets no target row. Writing one
 * would say the column produced nothing, which reads as a result rather than
 * as an empty cell. A verdict whose status is not one the store knows is
 * dropped for the same reason.
 *
 * Exported for unit testing.
 */
export const buildCarriedOverDispatches = ({
  tenantId,
  runId,
  experimentId,
  cells,
  datasetRows,
  evaluatorNameFor,
  occurredAt,
}: {
  tenantId: string;
  runId: string;
  experimentId: string;
  cells: CarriedOverCell[];
  datasetRows: Array<Record<string, unknown>>;
  evaluatorNameFor: (evaluatorId: string) => string | null;
  occurredAt: number;
}): {
  targetResults: RecordTargetResultCommandData[];
  evaluatorResults: RecordEvaluatorResultCommandData[];
} => {
  const targetResults: RecordTargetResultCommandData[] = [];
  const evaluatorResults: RecordEvaluatorResultCommandData[] = [];

  for (const cell of cells) {
    const datasetEntry = datasetRows[cell.rowIndex];
    if (!datasetEntry) continue;

    const target = carriedTargetResult({
      tenantId,
      runId,
      experimentId,
      cell,
      datasetEntry,
      occurredAt,
    });
    if (target) targetResults.push(target);

    evaluatorResults.push(
      ...carriedEvaluatorResults({
        tenantId,
        runId,
        experimentId,
        cell,
        evaluatorNameFor,
        occurredAt,
      }),
    );
  }

  return { targetResults, evaluatorResults };
};

/**
 * Writes the board cells the run carries into the run's stored results.
 *
 * Deliberately not routed through `processEventForStorage`, and deliberately
 * not put on the SSE stream. That helper also reports every evaluator result
 * into the evaluations pipeline, which would re-report verdicts from earlier
 * runs as if they had just happened; and a carried cell on the stream would
 * enter the backend runner's results draft and be written back over workbench
 * cells this run never produced.
 *
 * A failure to write one carried row is logged and dropped. The board is
 * context around the column the person asked for, so losing part of it must
 * not stop the run they started.
 */
const recordCarriedOverBoard = async ({
  projectId,
  runId,
  experimentId,
  cells,
  datasetRows,
  state,
  loadedEvaluators,
  commands,
}: {
  projectId: string;
  runId: string;
  experimentId: string;
  cells: CarriedOverCell[];
  datasetRows: Array<Record<string, unknown>>;
  state: EvaluationsV3State;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  commands: ReturnType<typeof getApp>["experimentRuns"];
}): Promise<void> => {
  if (cells.length === 0) return;

  const { targetResults, evaluatorResults } = buildCarriedOverDispatches({
    tenantId: projectId,
    runId,
    experimentId,
    cells,
    datasetRows,
    evaluatorNameFor: (evaluatorId) => {
      const config = state.evaluators.find(
        (evaluator) => evaluator.id === evaluatorId,
      );
      const dbEvaluator = config?.dbEvaluatorId
        ? loadedEvaluators?.get(config.dbEvaluatorId)
        : null;
      return dbEvaluator?.name ?? null;
    },
    occurredAt: Date.now(),
  });

  for (const dispatch of targetResults) {
    await commands.recordTargetResult(dispatch).catch((err: unknown) => {
      logger.warn(
        { err, runId, targetId: dispatch.targetId, index: dispatch.index },
        "Failed to record a carried-over target result",
      );
    });
  }

  for (const dispatch of evaluatorResults) {
    await commands.recordEvaluatorResult(dispatch).catch((err: unknown) => {
      logger.warn(
        {
          err,
          runId,
          targetId: dispatch.targetId,
          evaluatorId: dispatch.evaluatorId,
          index: dispatch.index,
        },
        "Failed to record a carried-over evaluator result",
      );
    });
  }

  logger.info(
    {
      runId,
      experimentId,
      carriedTargetResults: targetResults.length,
      carriedEvaluatorResults: evaluatorResults.length,
    },
    "Carried the board into the run",
  );
};

/**
 * Main orchestrator - executes all cells and yields SSE events.
 * Uses parallel execution with semaphore-based rate limiting.
 */
export async function* runOrchestrator(
  input: OrchestratorInput,
): AsyncGenerator<EvaluationV3Event> {
  const {
    projectId,
    experimentId,
    workflowVersionId,
    scope,
    state,
    datasetRows,
    datasetColumns,
    loadedPrompts,
    loadedAgents,
    loadedEvaluators,
    loadedWorkflows,
    runId: providedRunId,
    concurrency: requestedConcurrency,
    seedTargetOutputs,
    carriedOverCells,
    actor,
  } = input;

  // A personal development agent runs on one person's own machine, so only
  // that person may send it a turn. Refused before any cell exists, the way a
  // simulation refuses it when the run is scheduled.
  await assertConnectedAgentsRunnable({
    agents: [...loadedAgents.values()],
    actor,
    users: prisma,
  });

  // Use requested concurrency, environment variable, or default
  const concurrency = requestedConcurrency ?? DEFAULT_CONCURRENCY;

  // Use provided run ID or generate a human-readable one like "swift-fox-42"
  const runId = providedRunId ?? generateHumanReadableId();

  // Generate cells to execute
  const cells = generateCells(state, datasetRows, scope, {
    seedTargetOutputs,
  });
  // Phase-1 count only; grows by the Phase-2 (comparison) cell count once
  // those are generated after Phase 1 finishes, so the final summary's
  // completedCells (which counts both phases) never exceeds totalCells.
  let totalCells = cells.length;

  logger.info(
    {
      runId,
      totalCells,
      scopeType: scope.type,
      targetCount: state.targets.length,
    },
    "Starting orchestrator",
  );

  // Set running flag + record the owner, which is what abort authorizes
  // against. Set here rather than by the caller, so every dispatch path has it
  // from the first frame.
  await abortManager.setRunning(runId, projectId);

  // Get commands for ClickHouse dual-write (unconditional)
  const commands = getApp().experimentRuns;

  // Track CH dispatch failures for observability
  let chDispatchFailures = 0;
  let chDispatchTotal = 0;

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

  /**
   * `${rowIndex}:${targetId}` keys this run actually executed, as opposed to
   * inherited via seedTargetOutputs. Lets the Phase-2 block tell "we computed
   * this" from "we reused this", so only the reused ones need back-filling
   * into the run's stored results.
   */
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

  // One agent cache credential for this whole run, minted only when a target
  // actually runs Python. Undefined when nothing does, or when the mint
  // failed, and the engine then injects nothing.
  const sandboxApiKey = await mintRunSandboxApiKey({
    projectId,
    loadedAgents,
    loadedWorkflows,
  });

  // Dispatch event to ClickHouse.
  if (experimentId) {
    chDispatchTotal++;
    try {
      await commands.startExperimentRun({
        tenantId: projectId,
        runId,
        experimentId,
        workflowVersionId: workflowVersionId ?? null,
        total: totalCells,
        targets: targetMetadata,
        occurredAt: Date.now(),
      });
    } catch (err) {
      chDispatchFailures++;
      logger.error(
        { err, runId },
        "Failed to dispatch startExperimentRun to CH",
      );
      await abortManager.clearRunning(runId);
      throw err;
    }

    await recordCarriedOverBoard({
      projectId,
      runId,
      experimentId,
      cells: carriedOverCells ?? [],
      datasetRows,
      state,
      loadedEvaluators,
      commands,
    });
  }

  // Helper to process event for ClickHouse dispatch
  const processEventForStorage = async (event: EvaluationV3Event) => {
    // Track traceId from target_result so evaluator_result events can reference it.
    if (event.type === "target_result" && event.traceId) {
      cellTraceIds.set(`${event.rowIndex}:${event.targetId}`, event.traceId);
    }

    // Capture successful target outputs for Phase 2 pairwise cells.
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

    // Dispatch to evaluation processing pipeline for per-trace eval CH writes.
    if (event.type === "evaluator_result") {
      const evalResult = event.result as SingleEvaluationResult;
      const evaluatorConfig = state.evaluators.find(
        (e) => e.id === event.evaluatorId,
      );

      // Cache per-(row, target) evaluator scores so the Phase 2 comparison
      // judge can see what each variant already scored on its per-row
      // evaluators. Skip comparison evaluators themselves — a comparison judge
      // reading another comparison's verdict is circular.
      if (
        evalResult.status === "processed" &&
        evaluatorConfig &&
        !isComparisonEvaluator(evaluatorConfig)
      ) {
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
      }
      const dbEvaluator = evaluatorConfig?.dbEvaluatorId
        ? loadedEvaluators?.get(evaluatorConfig.dbEvaluatorId)
        : null;
      const traceId = cellTraceIds.get(`${event.rowIndex}:${event.targetId}`);
      const evaluationId = generate(KSUID_RESOURCES.EVALUATION).toString();
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
          score:
            evalResult.status === "processed"
              ? (evalResult.score ?? undefined)
              : undefined,
          passed:
            evalResult.status === "processed"
              ? (evalResult.passed ?? undefined)
              : undefined,
          // For pairwise verdicts, langevals now returns the winner's
          // candidate id (or "tie") directly in `label`. No translation
          // needed here; SDK / REST / MCP consumers see the winner by id.
          label:
            evalResult.status === "processed"
              ? (evalResult.label ?? undefined)
              : undefined,
          details:
            evalResult.status === "processed"
              ? (evalResult.details ?? undefined)
              : undefined,
          error: evalResult.status === "error" ? evalResult.details : undefined,
          occurredAt: Date.now(),
        });
      } catch (error) {
        logger.error(
          { error, evaluationId, evaluatorId: event.evaluatorId },
          "Failed to dispatch evaluator result to evaluation processing pipeline",
        );
      }
    }

    // Dispatch events to ClickHouse.
    if (experimentId) {
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

      if (targetResultDispatch) {
        chDispatchTotal++;
        await commands.recordTargetResult(targetResultDispatch).catch((err) => {
          chDispatchFailures++;
          logger.warn(
            { err, runId },
            "Failed to dispatch recordTargetResult to CH",
          );
        });
      } else if (event.type === "evaluator_result") {
        const result = event.result as SingleEvaluationResult;
        const evaluatorConfig = state.evaluators.find(
          (e) => e.id === event.evaluatorId,
        );
        const dbEvaluator = evaluatorConfig?.dbEvaluatorId
          ? loadedEvaluators?.get(evaluatorConfig.dbEvaluatorId)
          : null;
        chDispatchTotal++;
        await commands
          .recordEvaluatorResult(
            buildEvaluatorResultDispatch({
              tenantId: projectId,
              runId,
              experimentId,
              event,
              result,
              // Workflow evaluator nodes have no DB record, so fall back to
              // the name the event carries from the DSL node.
              evaluatorName: dbEvaluator?.name ?? event.evaluatorName ?? null,
              occurredAt: Date.now(),
            }),
          )
          .catch((err) => {
            chDispatchFailures++;
            logger.warn(
              { err, runId },
              "Failed to dispatch recordEvaluatorResult to CH",
            );
          });
      }
    }
  };

  // Emit execution_started
  yield {
    type: "execution_started",
    runId,
    total: totalCells,
  };

  const startTime = Date.now();
  let totalCost = 0;
  let failedCells = 0;
  let completedCells = 0;
  let aborted = false;

  logger.info(
    { runId, totalCells, concurrency, experimentId },
    "Starting evaluation execution",
  );

  // Event queue for collecting results from parallel executions
  // Uses a resolver pattern to allow yielding events as they arrive
  type EventResolver = (event: EvaluationV3Event | null) => void;
  let eventResolve: EventResolver | null = null;
  const eventQueue: EvaluationV3Event[] = [];
  let allCellsComplete = false;
  let completed = 0;

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

  // Create semaphore for rate limiting
  const semaphore = createSemaphore(concurrency);

  // Track active cell executions
  const activeCells = new Set<Promise<void>>();

  // Start processing cells in background
  const processingPromise = (async () => {
    try {
      // Process cells in parallel with rate limiting
      for (const cell of cells) {
        // Check abort flag before starting new cells
        if (await abortManager.isAborted(runId)) {
          logger.info({ runId }, "Execution aborted by user");
          aborted = true;
          break;
        }

        // Wait for semaphore slot
        await semaphore.acquire();

        // Start cell execution
        const cellPromise = (async () => {
          try {
            // Double-check abort flag after acquiring semaphore
            if (await abortManager.isAborted(runId)) {
              return;
            }

            // Get loaded data for this target
            const loadedData = {
              ...getLoadedDataForTarget(
                cell.targetConfig,
                loadedPrompts,
                loadedAgents,
                loadedWorkflows,
              ),
              evaluators: loadedEvaluators,
              sandboxApiKey,
            };

            // Create abort checker bound to this run
            const checkAbort = () => abortManager.isAborted(runId);

            // Pick the executor: a workflow target — or an agent target that
            // wraps a Studio workflow (agent.type === "workflow") — runs the
            // full studio workflow once per row via execute_flow; every other
            // target runs a single component. Both yield the same
            // target_result / evaluator_result events.
            const runsAsWorkflow =
              (cell.targetConfig.type === "workflow" ||
                (cell.targetConfig.type === "agent" &&
                  loadedData.agent?.type === "workflow")) &&
              !!loadedData.workflow;

            // A connected agent has no node in the engine: it runs in the
            // customer's own process and is reached through the relay.
            const connectedAgent =
              cell.targetConfig.type === "agent" &&
              loadedData.agent?.type === "connected"
                ? loadedData.agent
                : undefined;

            const cellEvents = connectedAgent
              ? executeConnectedCell({
                  cell,
                  projectId,
                  agent: connectedAgent,
                  datasetColumns,
                  loadedEvaluators,
                  resultMapperConfig,
                  isAborted: checkAbort,
                })
              : runsAsWorkflow
                ? executeWorkflowCell({
                    cell,
                    projectId,
                    workflowDsl: loadedData.workflow!.dsl,
                    datasetColumns,
                    loadedEvaluators,
                    resultMapperConfig,
                    isAborted: checkAbort,
                    sandboxApiKey,
                  })
                : executeCell(
                    cell,
                    projectId,
                    datasetColumns,
                    loadedData,
                    resultMapperConfig,
                    checkAbort,
                  );

            // Execute cell and collect events
            let cellFailed = false;
            let cellAborted = false;
            for await (const event of cellEvents) {
              // Check abort during cell processing
              if (await abortManager.isAborted(runId)) {
                cellAborted = true;
                break;
              }

              pushEvent(event);

              // Process for storage
              await processEventForStorage(event);

              // Track failures
              if (
                event.type === "error" ||
                (event.type === "target_result" && event.error)
              ) {
                cellFailed = true;
              }

              // Track costs
              if (event.type === "target_result" && event.cost) {
                totalCost += event.cost;
              }
            }

            // If aborted mid-cell, signal abort at the orchestrator level
            if (cellAborted) {
              aborted = true;
            }

            completed++;
            if (cellFailed) {
              failedCells++;
            } else {
              completedCells++;
            }

            // Add progress event
            const progressEvent: EvaluationV3Event = {
              type: "progress",
              completed,
              total: totalCells,
            };
            pushEvent(progressEvent);
            await processEventForStorage(progressEvent);
          } finally {
            semaphore.release();
          }
        })();

        activeCells.add(cellPromise);
        // Don't await here - let cells run in parallel
        // Clean up when cell completes
        void cellPromise.finally(() => activeCells.delete(cellPromise));
      }

      // Wait for all Phase 1 cells to complete
      await Promise.all(activeCells);

      // Phase 2: pairwise (#5100) + N-way select-best (#5101) cells.
      // Generated AFTER Phase 1 finishes because each Phase 2 cell needs
      // its variants' outputs to exist. We reuse the same semaphore +
      // executeCell loop; the new cells get appended to totalCells
      // dynamically so progress events stay honest. Pairwise and
      // select-best are generated by independent sibling functions
      // (they're two separate evaluators in the catalog) but share the
      // same execution loop, since the loop is per-cell not per-mode.
      // Phase 2 is only meaningful for a run that (re)produces variant outputs.
      //
      // An `evaluator` / `evaluator-all-rows` scope re-runs ONE evaluator over
      // outputs that already exist: its cells carry skipTarget + a precomputed
      // output and never yield a target_result, and the client seeds nothing for
      // them — so completedTargetOutputs is empty by construction. Running
      // Phase 2 anyway cannot produce a single verdict; every variant reads as
      // missing, and the only thing it emits is a "waiting on …" error written
      // over comparison verdicts the user never asked to re-run. Scoping its
      // ROWS (below) doesn't save it — for evaluator-all-rows every row is in
      // scope. The scope simply has no comparison work in it.
      const scopeCanProduceVariantOutputs =
        scope.type !== "evaluator" && scope.type !== "evaluator-all-rows";

      if (!aborted && scopeCanProduceVariantOutputs) {
        const { cells: phase2Cells, skipReasons } = generateComparisonCells({
          state,
          datasetRows,
          completedTargetOutputs,
          completedTargetEvaluatorScores,
          loadedPrompts,
          loadedEvaluators,
          // Only the rows this run owns. Without this, re-running row 1 alone
          // wrote "waiting on …" over every other row's verdict.
          scopedRowIndices: resolveScopedRowIndices({
            scope,
            rowCount: datasetRows.length,
          }),
        });

        // Fold Phase-2 cells into the run total now that we know how many
        // there are, so progress and the final summary stay consistent.
        totalCells += phase2Cells.length;

        // Emit a synthetic evaluator_result error event for each row we had
        // to skip. Without this the comparison column would sit at "No verdict
        // yet" indefinitely with no indication of what the real problem is.
        //
        // pushEvent feeds the SSE stream so the UI cell re-renders into the
        // friendlyError surface immediately; processEventForStorage also
        // writes it to ClickHouse for the historical record.
        for (const reason of skipReasons) {
          // Respect user-triggered abort mid-loop; otherwise a long skip-reason
          // burst would keep writing to CH after the run was meant to stop.
          if (await abortManager.isAborted(runId)) {
            aborted = true;
            break;
          }
          const { detail, errorType } = comparisonSkipMessage(reason);
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
          pushEvent(skipEvent);
          await processEventForStorage(skipEvent);
        }

        // Back-fill the candidate outputs this run REUSED rather than executed.
        //
        // Since #5789 fix 2, a comparison re-run deliberately does NOT re-run
        // variants whose output the client already has — it seeds them instead.
        // The upshot is that such a run stores only the judge's verdict: no
        // predicted output, no dataset entry, because no target cell ran. The
        // Results view builds its rows from target results, so a
        // comparison-only run rendered "No results to display" with $0 cost,
        // even though the judge had compared everything. Re-record what was
        // actually compared so a run's stored result stands on its own.
        //
        //
        // The seeded cost/duration are carried over rather than nulled. They
        // describe the output being compared, and the results table keys its
        // per-target header metrics off them — omitting them left every prompt
        // header on the Results page blank, which is how this surfaced. The
        // trade-off is that a run's cost total includes outputs it reused
        // rather than paid for, so summing cost ACROSS runs over-counts real
        // spend; describing the run's own results wins over that here, and it
        // matches what the workbench shows for the same cells.
        if (phase2Cells.length > 0 && seedTargetOutputs) {
          const rowsThisRunOwns = new Set(
            resolveScopedRowIndices({ scope, rowCount: datasetRows.length }),
          );
          for (const [key, seeded] of Object.entries(seedTargetOutputs)) {
            if (producedTargetKeys.has(key)) continue;
            const separator = key.indexOf(":");
            if (separator < 0) continue;
            const rowIndex = Number(key.slice(0, separator));
            const targetId = key.slice(separator + 1);
            if (!Number.isInteger(rowIndex)) continue;
            if (!rowsThisRunOwns.has(rowIndex)) continue;
            if (!datasetRows[rowIndex]) continue;
            if (seeded.output === null || seeded.output === undefined) continue;

            await processEventForStorage({
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
        }

        if (phase2Cells.length > 0) {
          logger.info(
            { runId, comparison: phase2Cells.length },
            "Starting Phase 2 (comparison) cells",
          );

          for (const cell of phase2Cells) {
            if (await abortManager.isAborted(runId)) {
              aborted = true;
              break;
            }
            await semaphore.acquire();

            const cellPromise = (async () => {
              try {
                if (await abortManager.isAborted(runId)) return;

                const loadedData = {
                  ...getLoadedDataForTarget(
                    cell.targetConfig,
                    loadedPrompts,
                    loadedAgents,
                  ),
                  evaluators: loadedEvaluators,
                  sandboxApiKey,
                };

                const checkAbort = () => abortManager.isAborted(runId);

                let cellFailed = false;
                for await (const event of executeCell(
                  cell,
                  projectId,
                  datasetColumns,
                  loadedData,
                  resultMapperConfig,
                  checkAbort,
                )) {
                  if (await abortManager.isAborted(runId)) break;
                  pushEvent(event);
                  await processEventForStorage(event);
                  if (event.type === "error") cellFailed = true;
                }

                completed++;
                if (cellFailed) failedCells++;
                else completedCells++;

                pushEvent({
                  type: "progress",
                  completed,
                  total: totalCells,
                });
              } finally {
                semaphore.release();
              }
            })();

            activeCells.add(cellPromise);
            void cellPromise.finally(() => activeCells.delete(cellPromise));
          }

          await Promise.all(activeCells);
        }
      }
    } finally {
      // Signal that all cells are complete
      signalComplete();
    }
  })();

  try {
    // Yield events as they arrive
    while (true) {
      const event = await waitForEvent();
      if (event === null) break;
      yield event;
    }

    // Emit stopped event if aborted
    if (aborted) {
      logger.info(
        { runId, completedCells, totalCells },
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

    const finishedAt = Date.now();

    // Dispatch completion event to ClickHouse.
    if (experimentId) {
      chDispatchTotal++;
      await commands
        .completeExperimentRun({
          tenantId: projectId,
          runId,
          experimentId,
          finishedAt: aborted ? null : finishedAt,
          stoppedAt: aborted ? finishedAt : null,
          occurredAt: Date.now(),
        })
        .catch((err) => {
          chDispatchFailures++;
          logger.warn(
            { err, runId },
            "Failed to dispatch completeExperimentRun to CH",
          );
        });
    }
  }

  // Log CH dispatch failure summary if any failed
  if (chDispatchFailures > 0) {
    logger.warn(
      { runId, chDispatchFailures, chDispatchTotal },
      `${chDispatchFailures} of ${chDispatchTotal} CH dispatches failed for run ${runId}`,
    );
  }

  // Only emit done if not aborted
  if (!aborted) {
    const finishedAt = Date.now();
    const duration = finishedAt - startTime;

    logger.info(
      { runId, completedCells, failedCells, totalCells, duration, totalCost },
      "Evaluation execution completed successfully",
    );

    // Emit done with summary
    const summary: ExecutionSummary = {
      runId,
      totalCells,
      completedCells,
      failedCells,
      duration,
      ...(chDispatchFailures > 0 && { chDispatchFailures }),
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
      { runId, completedCells, failedCells, totalCells, duration },
      "Evaluation execution stopped by user",
    );
  }
}

/**
 * Gets loaded prompt/agent data for a target.
 */
const getLoadedDataForTarget = (
  targetConfig: TargetConfig,
  loadedPrompts: Map<string, VersionedPrompt>,
  loadedAgents: Map<string, TypedAgent>,
  loadedWorkflows?: Map<string, LoadedWorkflow>,
): {
  prompt?: VersionedPrompt;
  agent?: TypedAgent;
  workflow?: LoadedWorkflow;
} => {
  if (targetConfig.type === "prompt" && targetConfig.promptId) {
    const prompt = loadedPrompts.get(promptLoadKey(targetConfig));
    if (prompt) {
      return { prompt };
    }
  }

  if (targetConfig.type === "agent" && targetConfig.dbAgentId) {
    const agent = loadedAgents.get(targetConfig.dbAgentId);
    if (agent) {
      // A workflow-type agent has no code of its own — it wraps a Studio
      // workflow, resolved by dataLoader and cached under the linked
      // workflow's own id (see loadPublishedWorkflow in dataLoader.ts).
      if (agent.type === "workflow") {
        const linkedWorkflowId =
          agent.workflowId ??
          (agent.config as { workflow_id?: string }).workflow_id;
        const workflow = linkedWorkflowId
          ? loadedWorkflows?.get(
              workflowLoadKey({ workflowId: linkedWorkflowId }),
            )
          : undefined;
        return { agent, workflow };
      }
      return { agent };
    }
  }

  if (targetConfig.type === "workflow" && targetConfig.workflowId) {
    const workflow = loadedWorkflows?.get(workflowLoadKey(targetConfig));
    if (workflow) {
      return { workflow };
    }
  }

  // For local configs, no pre-loaded data needed
  return {};
};

/**
 * Requests abort of a running execution.
 */
export const requestAbort = async (runId: string): Promise<void> => {
  await abortManager.requestAbort(runId);
};
