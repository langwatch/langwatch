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

import { generate } from "@langwatch/ksuid";
import { studioBackendPostEvent } from "~/app/api/workflows/post_event/post-event";
import type {
  EvaluationsV3State,
  EvaluatorConfig,
  TargetConfig,
} from "~/experiments-v3/types";
import { isRowEmpty } from "~/experiments-v3/utils/emptyRowDetection";
import { addEnvs } from "~/optimization_studio/server/addEnvs";
import { loadDatasets } from "~/optimization_studio/server/loadDatasets";
import type { StudioServerEvent } from "~/optimization_studio/types/events";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { getApp } from "~/server/app-layer/app";
import type { SingleEvaluationResult } from "~/server/evaluations/evaluators";
import type { ESBatchEvaluationTarget } from "~/server/experiments/types";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { KSUID_RESOURCES } from "~/utils/constants";
import { generateHumanReadableId } from "~/utils/humanReadableId";
import { createLogger } from "~/utils/logger/server";
import { generateOtelTraceId } from "~/utils/trace";
import { abortManager } from "./abortManager";
import { buildStripScoreEvaluatorIds } from "./evaluatorScoreFilter";
import {
  mapErrorEvent,
  mapNlpEvent,
  type ResultMapperConfig,
} from "./resultMapper";
import { createSemaphore } from "./semaphore";
import type {
  EvaluationV3Event,
  ExecutionCell,
  ExecutionScope,
  ExecutionSummary,
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
  /** Optional run ID - if not provided, a human-readable ID will be generated */
  runId?: string;
  /** Concurrency limit for parallel execution (default 10) */
  concurrency?: number;
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
): ExecutionCell[] => {
  const cells: ExecutionCell[] = [];
  const datasetId =
    state.datasets[0]?.id ?? state.activeDatasetId ?? "dataset-1";

  // Handle evaluator-all-rows scope - run one evaluator across all rows with existing target outputs
  if (scope.type === "evaluator-all-rows") {
    const targetConfig = state.targets.find(
      (t: TargetConfig) => t.id === scope.targetId,
    );
    const evaluatorConfig = state.evaluators.find(
      (e) => e.id === scope.evaluatorId,
    );

    if (!targetConfig || !evaluatorConfig) return cells;

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

    if (targetConfig && evaluatorConfig && datasetEntry) {
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

  // Determine which rows to process
  const rowIndices =
    scope.type === "full"
      ? datasetRows.map((_, i) => i)
      : scope.type === "rows"
        ? scope.rowIndices.filter((i) => i >= 0 && i < datasetRows.length)
        : scope.type === "target"
          ? datasetRows.map((_, i) => i)
          : scope.type === "cell"
            ? [scope.rowIndex]
            : [];

  // Determine which targets to process.
  //
  // For target-/cell-scoped runs against a pairwise column-target, the
  // pairwise verdict needs both variants' outputs to exist before Phase 2
  // can synthesize the comparison cell. If the user hits Play on the
  // Pairwise Compare column without first running the variants, expand
  // the scope to include variantA + variantB so Phase 1 produces what
  // Phase 2 needs. Without this, only the pairwise target is dispatched,
  // Phase 1 skips it (column-style pairwise is always Phase-2-only),
  // and the run completes with 0 cells — visible to the user as a
  // silent no-op with "No verdict yet" everywhere.
  const expandPairwiseDeps = (id: string): string[] => {
    const t = state.targets.find((tg: TargetConfig) => tg.id === id);
    if (!t || t.type !== "evaluator" || !t.pairwise) return [id];
    const deps = [t.pairwise.variantA, t.pairwise.variantB].filter(
      (v): v is string => !!v,
    );
    return Array.from(new Set([...deps, id]));
  };

  const targetIds =
    scope.type === "full"
      ? state.targets.map((t: TargetConfig) => t.id)
      : scope.type === "rows"
        ? state.targets.map((t: TargetConfig) => t.id)
        : scope.type === "target"
          ? expandPairwiseDeps(scope.targetId)
          : scope.type === "cell"
            ? expandPairwiseDeps(scope.targetId)
            : [];

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
      const targetConfig = state.targets.find(
        (t: TargetConfig) => t.id === targetId,
      );
      if (!targetConfig) continue;

      // Skip column-style pairwise targets (#5100) in Phase 1 — they need
      // both variants' outputs which are not yet available in a single
      // per-target cell. Picked up by generatePairwiseCells in Phase 2.
      // Strictly additive: only triggered when target.pairwise is set,
      // which only happens for column-style langevals/pairwise_compare.
      if (targetConfig.type === "evaluator" && targetConfig.pairwise) {
        continue;
      }

      cells.push({
        rowIndex,
        targetId,
        targetConfig,
        // Pairwise evaluators run in Phase 2 after both variants' outputs
        // exist — they would crash here because candidate_b's output is not
        // available within a single per-target cell. See generatePairwiseCells.
        evaluatorConfigs: state.evaluators.filter((e) => !e.pairwise),
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
 * Phase 2 cell generator for pairwise evaluators (#5100).
 *
 * Called AFTER Phase 1 (per-target) cells complete. For each pairwise
 * evaluator and each rowIndex where BOTH variantA and variantB outputs
 * exist in `completedTargetOutputs`, emit a synthetic cell whose
 * `pairwise` field carries both candidates. The cell's `targetId` points
 * at variantA so the workflow builder has a real TargetConfig to lean on;
 * `skipTarget` short-circuits target execution. `buildEvaluatorInputs`
 * branches on `cell.pairwise` to assemble the candidate_* + golden inputs.
 *
 * Rows where one variant failed to produce an output are reported via
 * `skipReasons` (not silently dropped) so the caller can emit a synthetic
 * error event per row — otherwise the pairwise column sits at
 * "No verdict yet" with no indication that the upstream variant failed.
 */
export type PairwiseSkipReason = {
  rowIndex: number;
  /** TargetId under which the pairwise verdict would have been stored. */
  targetId: string;
  /** The synthetic evaluator id whose cell would have run. */
  evaluatorId: string;
  /** Display-friendly identifier of variantA. */
  variantAName: string;
  /** Display-friendly identifier of variantB. */
  variantBName: string;
  /** Which side(s) had no output for this row. */
  missing: "A" | "B" | "both";
};

export const generatePairwiseCells = (
  state: Pick<
    EvaluationsV3State,
    "datasets" | "activeDatasetId" | "targets" | "evaluators"
  >,
  datasetRows: Array<Record<string, unknown>>,
  completedTargetOutputs: Map<
    string,
    { output: unknown; cost?: number; duration?: number }
  >,
  completedTargetEvaluatorScores?: Map<
    string,
    Array<{ name: string; score?: number; label?: string; passed?: boolean }>
  >,
  loadedPrompts?: Map<string, VersionedPrompt>,
): { cells: ExecutionCell[]; skipReasons: PairwiseSkipReason[] } => {
  const cells: ExecutionCell[] = [];
  const skipReasons: PairwiseSkipReason[] = [];
  const datasetId =
    state.datasets[0]?.id ?? state.activeDatasetId ?? "dataset-1";

  // Augment a candidate's output text with the variant's existing evaluator
  // scores so the pairwise judge can factor them into the verdict. Skips
  // silently when there are no scores, when the output isn't string-ish, or
  // when the scores map isn't provided.
  const withEvaluatorScores = (
    output: unknown,
    rowIndex: number,
    variantId: string,
  ): unknown => {
    if (!completedTargetEvaluatorScores) return output;
    const scores = completedTargetEvaluatorScores.get(
      `${rowIndex}:${variantId}`,
    );
    if (!scores || scores.length === 0) return output;
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
    if (lines.length === 0) return output;
    const block = `\n\n--- Existing evaluator scores ---\n${lines.join("\n")}`;
    if (typeof output === "string") return output + block;
    try {
      return JSON.stringify(output) + block;
    } catch {
      return String(output ?? "") + block;
    }
  };

  // Pick the most human-readable identifier we can derive from a TargetConfig.
  // langevals echoes `candidate_a_id` / `candidate_b_id` back to us as the
  // `label` on the verdict, and that label is what every programmatic consumer
  // (REST, SDK, MCP) will read first — so the prompt's HANDLE ("say-hi") beats
  // its KSUID-prefixed db id ("prompt_6IFkbb…") which beats the internal
  // target id ("target_…"). `loadedPrompts` is keyed by `target.promptId`.
  const variantIdentifierFor = (t: TargetConfig): string => {
    if (t.type === "prompt" && t.promptId) {
      const handle = loadedPrompts?.get(t.promptId)?.handle;
      if (handle) return handle;
      return t.promptId;
    }
    return t.id;
  };

  const pairwiseEvaluators = state.evaluators.filter((e) => e.pairwise);
  // Column-style pairwise targets (#5100): same Phase-2 treatment as chip
  // evaluators, just with a synthetic EvaluatorConfig synthesized from the
  // target's stored pairwise config. Keeping both paths in one generator
  // keeps Phase 2 storage / progress accounting identical.
  const pairwiseTargets = state.targets.filter(
    (t) => t.type === "evaluator" && t.pairwise,
  );
  if (pairwiseEvaluators.length === 0 && pairwiseTargets.length === 0) {
    return { cells, skipReasons };
  }

  for (const evaluator of pairwiseEvaluators) {
    const cfg = evaluator.pairwise;
    if (!cfg) continue;

    const variantA = state.targets.find((t) => t.id === cfg.variantA);
    const variantB = state.targets.find((t) => t.id === cfg.variantB);
    if (!variantA || !variantB) {
      logger.warn(
        {
          evaluatorId: evaluator.id,
          variantA: cfg.variantA,
          variantB: cfg.variantB,
        },
        "Pairwise evaluator skipped: variant target(s) not found",
      );
      continue;
    }

    for (let rowIndex = 0; rowIndex < datasetRows.length; rowIndex++) {
      const datasetEntry = datasetRows[rowIndex];
      if (!datasetEntry) continue;

      const a = completedTargetOutputs.get(`${rowIndex}:${cfg.variantA}`);
      const b = completedTargetOutputs.get(`${rowIndex}:${cfg.variantB}`);
      if (!a || !b) {
        skipReasons.push({
          rowIndex,
          targetId: cfg.variantA,
          evaluatorId: evaluator.id,
          variantAName: variantIdentifierFor(variantA),
          variantBName: variantIdentifierFor(variantB),
          missing: !a && !b ? "both" : !a ? "A" : "B",
        });
        continue;
      }

      cells.push({
        rowIndex,
        // Point at variantA so the workflow builder has a real TargetConfig.
        // The target step itself is skipped via `skipTarget` below.
        targetId: cfg.variantA,
        targetConfig: variantA,
        evaluatorConfigs: [evaluator],
        datasetEntry: {
          _datasetId: datasetId,
          ...datasetEntry,
        },
        skipTarget: true,
        precomputedTargetOutput: a.output,
        pairwise: {
          candidateA: {
            id: variantIdentifierFor(variantA),
            output: withEvaluatorScores(a.output, rowIndex, cfg.variantA),
            cost: a.cost,
            duration: a.duration,
          },
          candidateB: {
            id: variantIdentifierFor(variantB),
            output: withEvaluatorScores(b.output, rowIndex, cfg.variantB),
            cost: b.cost,
            duration: b.duration,
          },
        },
      });
    }
  }

  // Column-style pairwise targets (#5100). Each is its own column whose
  // verdict cell stores results under TargetId=column-target.id. A
  // synthetic EvaluatorConfig (constructed from the target's pairwise
  // config + dbEvaluatorId) gives buildEvaluatorInputs everything it
  // needs to take the pairwise branch, and downstream storage records
  // the verdict against the pairwise column rather than variantA.
  for (const target of pairwiseTargets) {
    const cfg = target.pairwise;
    if (!cfg || !target.targetEvaluatorId) continue;

    // Skip column-style pairwise targets where the user hasn't finished
    // configuring the form. Without all three the judge endpoint would
    // 400 with "<field> is required" and the cell would render that as
    // a verdict-shaped error — confusing for users who haven't opened
    // the drawer yet.
    if (!cfg.variantA || !cfg.variantB || !cfg.goldenField) {
      logger.debug(
        {
          targetId: target.id,
          variantA: cfg.variantA,
          variantB: cfg.variantB,
          goldenField: cfg.goldenField,
        },
        "Pairwise column-target skipped: variants or golden field not configured",
      );
      continue;
    }

    const variantA = state.targets.find((t) => t.id === cfg.variantA);
    const variantB = state.targets.find((t) => t.id === cfg.variantB);
    if (!variantA || !variantB) {
      logger.warn(
        {
          targetId: target.id,
          variantA: cfg.variantA,
          variantB: cfg.variantB,
        },
        "Pairwise column-target skipped: variant target(s) not found",
      );
      continue;
    }

    for (let rowIndex = 0; rowIndex < datasetRows.length; rowIndex++) {
      const datasetEntry = datasetRows[rowIndex];
      if (!datasetEntry) continue;

      const a = completedTargetOutputs.get(`${rowIndex}:${cfg.variantA}`);
      const b = completedTargetOutputs.get(`${rowIndex}:${cfg.variantB}`);
      if (!a || !b) {
        skipReasons.push({
          rowIndex,
          targetId: target.id,
          evaluatorId: target.id,
          variantAName: variantIdentifierFor(variantA),
          variantBName: variantIdentifierFor(variantB),
          missing: !a && !b ? "both" : !a ? "A" : "B",
        });
        continue;
      }

      // Per-row synthetic evaluator with PRE-RESOLVED value mappings for
      // every pairwise input field. Pre-fix (#5131) the synthetic was
      // shared across rows with `mappings: {}`, leaving the candidate_*
      // fields to be filled in by buildEvaluatorInputs's pairwise branch
      // and propagated as manual inputs. That path silently dropped
      // candidate_a_output / candidate_b_output (plus cost/duration) on
      // the wire — the route's downstream `getEvaluatorDataForParams`
      // rebuilt `data` from the legacy 6-field default schema, stripping
      // everything not value-mapped at build time. Embedding the
      // candidates as `value` mappings here means buildEvaluatorNode
      // bakes them into the workflow node's static inputs (and the
      // mapping-branch fallback in buildEvaluatorInputs sees them too)
      // so the candidate fields always reach the judge regardless of
      // which code path the dispatch ends up in.
      const perRowMappings: Record<
        string,
        Record<string, Record<string, { type: "value"; value: unknown }>>
      > = {
        [datasetId]: {
          [target.id]: {
            candidate_a_id: {
              type: "value",
              value: variantIdentifierFor(variantA),
            },
            candidate_a_output: {
              type: "value",
              value: withEvaluatorScores(a.output, rowIndex, cfg.variantA),
            },
            candidate_a_cost:
              a.cost !== undefined
                ? { type: "value", value: a.cost }
                : { type: "value", value: undefined },
            candidate_a_duration:
              a.duration !== undefined
                ? { type: "value", value: a.duration }
                : { type: "value", value: undefined },
            candidate_b_id: {
              type: "value",
              value: variantIdentifierFor(variantB),
            },
            candidate_b_output: {
              type: "value",
              value: withEvaluatorScores(b.output, rowIndex, cfg.variantB),
            },
            candidate_b_cost:
              b.cost !== undefined
                ? { type: "value", value: b.cost }
                : { type: "value", value: undefined },
            candidate_b_duration:
              b.duration !== undefined
                ? { type: "value", value: b.duration }
                : { type: "value", value: undefined },
            input: {
              type: "value",
              value: datasetEntry.input ?? datasetEntry[cfg.goldenField],
            },
            golden: {
              type: "value",
              value: datasetEntry[cfg.goldenField],
            },
          },
        },
      };

      const syntheticEvaluator = {
        id: target.id,
        dbEvaluatorId: target.targetEvaluatorId,
        evaluatorType: "langevals/pairwise_compare",
        pairwise: cfg,
        inputs: target.inputs,
        mappings: perRowMappings,
      } as unknown as EvaluatorConfig;

      cells.push({
        rowIndex,
        // Use the column-target's id so the verdict lands in the pairwise
        // column rather than under variantA's column. Differs from the
        // chip-style path above where verdicts hang under variantA.
        targetId: target.id,
        targetConfig: target,
        evaluatorConfigs: [syntheticEvaluator],
        datasetEntry: {
          _datasetId: datasetId,
          ...datasetEntry,
        },
        skipTarget: true,
        precomputedTargetOutput: a.output,
        pairwise: {
          candidateA: {
            id: variantIdentifierFor(variantA),
            output: withEvaluatorScores(a.output, rowIndex, cfg.variantA),
            cost: a.cost,
            duration: a.duration,
          },
          candidateB: {
            id: variantIdentifierFor(variantB),
            output: withEvaluatorScores(b.output, rowIndex, cfg.variantB),
            cost: b.cost,
            duration: b.duration,
          },
        },
      });
    }
  }

  return { cells, skipReasons };
};

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
      const enrichedEvent = await loadDatasets(
        await addEnvs(rawEvent, projectId),
        projectId,
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
        const mappedEvent = mapNlpEvent(
          event,
          cell.rowIndex,
          targetNodes,
          cellConfig,
        );
        if (mappedEvent) {
          yield mappedEvent;
        }
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
          const enrichedEvaluatorEvent = await addEnvs(
            evaluatorEvent,
            projectId,
          );

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
            const mappedEvent = mapNlpEvent(
              event,
              cell.rowIndex,
              targetNodes,
              cellConfig,
            );
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
              details: (evalError as Error).message,
              traceback: [],
            },
          };
        }
      }
    }
  } catch (error) {
    logger.error(
      { error, rowIndex: cell.rowIndex, targetId: cell.targetId },
      "Cell execution failed",
    );
    yield mapErrorEvent((error as Error).message, cell.rowIndex, cell.targetId);
  }
}

/**
 * Builds the input values for an evaluator from target output and dataset entry.
 *
 * Note: Dataset entries are normalized to use column NAMES as keys at the API boundary,
 * so we can use mapping.sourceField directly without ID-to-name translation.
 */
const buildEvaluatorInputs = (
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

  // Pairwise branch (#5100): synthetic inputs bypassing the per-target
  // mapping system. We have explicit knowledge of where each field comes
  // from (golden -> dataset[goldenField]; candidate_* -> cell.pairwise),
  // so we assemble them directly. `input` still uses an existing mapping
  // (variantA's) if configured, otherwise falls back to the dataset's
  // `input` column.
  if (evaluator.pairwise && cell.pairwise) {
    const cfg = evaluator.pairwise;
    const variantAMappings =
      evaluator.mappings[datasetId]?.[cfg.variantA] ?? {};
    const inputMapping = variantAMappings.input;
    if (inputMapping?.type === "source" && inputMapping.source === "dataset") {
      inputs.input = cell.datasetEntry[inputMapping.sourceField];
    } else if (cell.datasetEntry.input !== undefined) {
      inputs.input = cell.datasetEntry.input;
    }

    inputs.golden = cell.datasetEntry[cfg.goldenField];

    // Helper: only assign when defined, so JSON.stringify doesn't drop the
    // key for the keep-defined receiver but also doesn't leak literal
    // `undefined`s into the body.
    const setIfDefined = (key: string, value: unknown): void => {
      if (value !== undefined) inputs[key] = value;
    };

    setIfDefined("candidate_a_id", cell.pairwise.candidateA.id);
    setIfDefined("candidate_a_output", cell.pairwise.candidateA.output);
    setIfDefined("candidate_a_cost", cell.pairwise.candidateA.cost);
    setIfDefined("candidate_a_duration", cell.pairwise.candidateA.duration);
    setIfDefined("candidate_b_id", cell.pairwise.candidateB.id);
    setIfDefined("candidate_b_output", cell.pairwise.candidateB.output);
    setIfDefined("candidate_b_cost", cell.pairwise.candidateB.cost);
    setIfDefined("candidate_b_duration", cell.pairwise.candidateB.duration);

    // Defensive fallback: when generatePairwiseCells lost a candidate
    // output between completedTargetOutputs.set and the cell push (eg.
    // a stale reference), pull the value from the per-row synthetic
    // mappings we now also populate at cell-creation time. Strictly
    // additive — only fires when the primary cell.pairwise read came
    // back undefined.
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
    runId: providedRunId,
    concurrency: requestedConcurrency,
  } = input;

  // Use requested concurrency, environment variable, or default
  const concurrency = requestedConcurrency ?? DEFAULT_CONCURRENCY;

  // Use provided run ID or generate a human-readable one like "swift-fox-42"
  const runId = providedRunId ?? generateHumanReadableId();

  // Generate cells to execute
  const cells = generateCells(state, datasetRows, scope);
  const totalCells = cells.length;

  logger.info(
    {
      runId,
      totalCells,
      scopeType: scope.type,
      targetCount: state.targets.length,
    },
    "Starting orchestrator",
  );

  // Set running flag + record the owner so abort can authorize this run even
  // on the interactive SSE path, which never creates a polling run-state record.
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
  // payload before they execute.
  const completedTargetOutputs = new Map<
    string,
    { output: unknown; cost?: number; duration?: number }
  >();

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

  // Build target metadata for storage
  // For model: first check localPromptConfig, then fall back to loadedPrompts
  // For name: get from loaded entity (prompt, agent, or evaluator)
  const targetMetadata: ESBatchEvaluationTarget[] = state.targets.map((t) => {
    let model: string | null = null;
    let name: string | null = null;

    // First check local prompt config (for edited prompts)
    if (t.localPromptConfig?.llm?.model) {
      model = t.localPromptConfig.llm.model;
    }
    // Otherwise, check loaded prompts (for saved prompts)
    else if (t.type === "prompt" && t.promptId) {
      const loadedPrompt = loadedPrompts.get(t.promptId);
      if (loadedPrompt?.model) {
        model = loadedPrompt.model;
      }
    }

    // Get name from loaded entity
    if (t.type === "prompt" && t.promptId) {
      name = loadedPrompts.get(t.promptId)?.name ?? null;
    } else if (t.type === "agent" && t.dbAgentId) {
      name = loadedAgents.get(t.dbAgentId)?.name ?? null;
    } else if (t.type === "evaluator" && t.targetEvaluatorId) {
      name = loadedEvaluators?.get(t.targetEvaluatorId)?.name ?? null;
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

  // Build config for result mapper - determines which evaluators have scores stripped
  const resultMapperConfig: ResultMapperConfig = {
    stripScoreEvaluatorIds: buildStripScoreEvaluatorIds(state.evaluators),
  };

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
    }

    // Dispatch to evaluation processing pipeline for per-trace eval CH writes.
    if (event.type === "evaluator_result") {
      const evalResult = event.result as SingleEvaluationResult;
      const evaluatorConfig = state.evaluators.find(
        (e) => e.id === event.evaluatorId,
      );

      // Cache per-(row, target) evaluator scores so the Phase 2 pairwise judge
      // can see what each variant already scored on its non-pairwise
      // evaluators. Skip pairwise evaluators themselves (a pairwise judge
      // reading another pairwise verdict is circular).
      if (
        evalResult.status === "processed" &&
        evaluatorConfig &&
        !evaluatorConfig.pairwise
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
      if (event.type === "target_result") {
        const datasetEntry = datasetRows[event.rowIndex] ?? {};
        chDispatchTotal++;
        await commands
          .recordTargetResult({
            tenantId: projectId,
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
            traceId: event.traceId ?? null,
            occurredAt: Date.now(),
          })
          .catch((err) => {
            chDispatchFailures++;
            logger.warn(
              { err, runId },
              "Failed to dispatch recordTargetResult to CH",
            );
          });
      } else if (
        event.type === "error" &&
        event.rowIndex !== undefined &&
        event.targetId
      ) {
        const datasetEntry = datasetRows[event.rowIndex] ?? {};
        chDispatchTotal++;
        await commands
          .recordTargetResult({
            tenantId: projectId,
            runId,
            experimentId,
            index: event.rowIndex,
            targetId: event.targetId,
            entry: datasetEntry,
            predicted: null,
            cost: null,
            duration: null,
            error: event.message,
            traceId: null,
            occurredAt: Date.now(),
          })
          .catch((err) => {
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
          .recordEvaluatorResult({
            tenantId: projectId,
            runId,
            experimentId,
            index: event.rowIndex,
            targetId: event.targetId,
            evaluatorId: event.evaluatorId,
            evaluatorName: dbEvaluator?.name ?? null,
            status: result.status,
            score: result.status === "processed" ? result.score : null,
            label: result.status === "processed" ? result.label : null,
            passed: result.status === "processed" ? result.passed : null,
            details:
              result.status === "error"
                ? result.details
                : result.status === "processed"
                  ? result.details
                  : null,
            occurredAt: Date.now(),
            cost:
              result.status === "processed" && result.cost
                ? result.cost.amount
                : null,
          })
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
              ),
              evaluators: loadedEvaluators,
            };

            // Create abort checker bound to this run
            const checkAbort = () => abortManager.isAborted(runId);

            // Execute cell and collect events
            let cellFailed = false;
            let cellAborted = false;
            for await (const event of executeCell(
              cell,
              projectId,
              datasetColumns,
              loadedData,
              resultMapperConfig,
              checkAbort,
            )) {
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

      // Phase 2: pairwise cells (#5100). Generated AFTER Phase 1 finishes,
      // because each pairwise cell needs both variants' outputs to exist.
      // We reuse the same semaphore + executeCell loop; the new cells get
      // appended to totalCells dynamically so progress events stay honest.
      if (!aborted) {
        const { cells: pairwiseCells, skipReasons: pairwiseSkipReasons } =
          generatePairwiseCells(
            state,
            datasetRows,
            completedTargetOutputs,
            completedTargetEvaluatorScores,
            loadedPrompts,
          );

        // Emit a synthetic evaluator_result error event for each row we had
        // to skip because a variant didn't produce output. Without this the
        // pairwise column would sit at "No verdict yet" indefinitely with
        // no indication that the upstream prompt is the actual problem.
        for (const reason of pairwiseSkipReasons) {
          const which =
            reason.missing === "both"
              ? `${reason.variantAName} and ${reason.variantBName}`
              : reason.missing === "A"
                ? reason.variantAName
                : reason.variantBName;
          const detail = `Pairwise can't compare — ${which} produced no output for this row. Run the upstream variant first or check it for errors.`;
          await processEventForStorage({
            type: "evaluator_result",
            rowIndex: reason.rowIndex,
            targetId: reason.targetId,
            evaluatorId: reason.evaluatorId,
            result: {
              status: "error",
              details: detail,
              error_type: "MissingVariantOutput",
            } as unknown as SingleEvaluationResult,
          });
        }

        if (pairwiseCells.length > 0) {
          logger.info(
            { runId, count: pairwiseCells.length },
            "Starting Phase 2 (pairwise) cells",
          );

          for (const cell of pairwiseCells) {
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
                  total: totalCells + pairwiseCells.length,
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
): { prompt?: VersionedPrompt; agent?: TypedAgent } => {
  if (targetConfig.type === "prompt" && targetConfig.promptId) {
    const prompt = loadedPrompts.get(targetConfig.promptId);
    if (prompt) {
      return { prompt };
    }
  }

  if (targetConfig.type === "agent" && targetConfig.dbAgentId) {
    const agent = loadedAgents.get(targetConfig.dbAgentId);
    if (agent) {
      return { agent };
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
