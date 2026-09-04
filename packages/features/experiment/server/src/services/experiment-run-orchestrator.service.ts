/** Manages evaluation execution across multiple cells: builds and dispatches workflows, maps events to SSE, and coordinates parallel, abortable runs. */

import { createLogger } from "@langwatch/observability";
import {
  type CarriedOverCell,
  type ESBatchEvaluationTarget,
  type EvaluationsV3State,
  type EvaluationV3Event,
  type EvaluatorConfig,
  type ExecutionCell,
  type ExecutionScope,
  type ExecutionSummary,
  type ExperimentService,
  generateHumanReadableId,
  type RecordEvaluatorResultCommandData,
  type RecordTargetResultCommandData,
  type TargetConfig,
} from "@langwatch/experiment-contract";
import type { ExecutionState, StudioWorkflow, WorkflowService } from "@langwatch/workflow-contract";
import type { Agent as TypedAgent } from "@langwatch/agent-contract";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import { generateOtelSpanId, generateOtelTraceId } from "@langwatch/trace-contract";
import { EvaluatorNoInputsResolvedError } from "../experiment-execution.errors";
import type { ExperimentEvaluationReportingPort } from "../ports/experiment-evaluation-reporting.port";
import type { ExperimentModelCostPort } from "../ports/experiment-model-cost.port";
import type { ExperimentRunAbortPort } from "../ports/experiment-run-abort.port";
import type { ExperimentSandboxCredentialPort } from "../ports/experiment-sandbox-credential.port";
import type { ExperimentStudioDispatchPort } from "../ports/experiment-studio-dispatch.port";
import { buildStripScoreEvaluatorIds } from "../processes/experiment-evaluator-score-filter.process";
import {
  buildCellWorkflow,
  buildEvaluatorCellWorkflow,
} from "../processes/experiment-cell-workflow.process";
// The connected-agent relay of ADR-128. Its dispatcher, runtime and refusal
// live in the Agent and Suite feature packages; a build without them
// cannot run a connected column.
import type { CallOutcome, DispatchAgent, DispatchCall } from "@langwatch/agent-contract";
import type { RunActor } from "@langwatch/scenario-contract";
import { assertConnectedAgentsRunnable } from "@langwatch/suite-server";
import type { ResultMapperConfig } from "../processes/experiment-result-mapping.process";
import { createSemaphore } from "../processes/experiment-run-semaphore.process";
import { createEventStream } from "../processes/experiment-run-event-stream.process";
import {
  evaluatorErrorResult,
  evaluatorTargetNoInputsResult,
  noInputsResolvedResult,
} from "../processes/experiment-cell-error-events.process";
import {
  type LoadedEvaluators,
  type LoadedWorkflow,
  promptLoadKey,
  workflowLoadKey,
} from "./experiment-execution-data.service";
import { ExperimentResultDispatchService } from "./experiment-result-dispatch.service";
import { ExperimentCarriedBoardService } from "./experiment-carried-board.service";
import { ExperimentEvaluatorInputService } from "./experiment-evaluator-input.service";
import { ExperimentCellPlanService, type SeededTargetOutput } from "./experiment-cell-plan.service";
import {
  ExperimentComparisonPlanService,
  type VariantEvaluatorScore,
} from "./experiment-comparison-plan.service";
import {
  ExperimentCellExecutionService,
  type LoadedCellData,
} from "./experiment-cell-execution.service";
import { ExperimentWorkflowCellService } from "./experiment-workflow-cell.service";
import { ExperimentConnectedCellService } from "./experiment-connected-cell.service";
import { ExperimentRunSandboxKeyService } from "./experiment-run-sandbox-key.service";
import { ExperimentRunStorageService } from "./experiment-run-storage.service";
import {
  comparisonSkipMessage as processComparisonSkipMessage,
  formatList as processFormatList,
  type ComparisonSkipReason,
} from "../processes/experiment-comparison-skip.process";

const logger = createLogger("langwatch:experiment:run-orchestrator");

/** Everything the run loop reaches outside itself, injected as one bag rather than threaded per-signature or read off a process singleton. */
export type ExperimentRunPorts = {
  /** The studio engine each cell is dispatched to. */
  studio: ExperimentStudioDispatchPort;
  /** The deployment's price table, for cells the engine reports untariffed. */
  cost: ExperimentModelCostPort;
  /** The stop signal and the owner record this run's abort is authorized against. */
  abort: ExperimentRunAbortPort;
  /** The Eventing command surface a run's results are dispatched through. */
  experiments: ExperimentService;
  /** Where a cell's evaluator result is reported as an evaluation. */
  evaluationReporting: ExperimentEvaluationReportingPort;
  /** The scoped key a run lends to the code it executes. */
  sandboxCredentials: ExperimentSandboxCredentialPort;
};

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
  ports: ExperimentRunPorts;
  workflows: WorkflowService;
  /** Evaluators loaded from DB - settings and names are fetched fresh from here */
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  /** Studio workflows loaded for workflow targets (committed DSL run per row) */
  loadedWorkflows?: Map<string, LoadedWorkflow>;
  /** Optional run ID - if not provided, a human-readable ID will be generated */
  runId?: string;
  /** Process-configured default used when the request does not choose a limit. */
  defaultConcurrency: number;
  /** Request-specific concurrency limit. */
  concurrency?: number;
  /**
   * Pre-existing target outputs keyed by `${rowIndex}:${targetId}`. Phase 2
   * pairwise reads from these when the user re-runs only the pairwise
   * column on top of variants that already produced output in a prior run.
   */
  seedTargetOutputs?: Record<string, { output: unknown; cost?: number; duration?: number }>;
  /**
   * Board cells the run carries rather than produces, so the run holds the
   * whole board and not only the column that was clicked.
   */
  carriedOverCells?: CarriedOverCell[];
  /**
   * Who started the run, when a person did. A personal development agent
   * belongs to the person whose key registered it; a run naming no person
   * is refused the same way a simulation is.
   */
  actor?: RunActor;
};

const cellPlan = ExperimentCellPlanService.create();

/** The dataset rows a run may touch, given its scope. Delegates to {@link ExperimentCellPlanService}. */
export const resolveScopedRowIndices = (
  input: Parameters<ExperimentCellPlanService["resolveScopedRowIndices"]>[0],
): number[] => cellPlan.resolveScopedRowIndices(input);

/** Generates all cells to execute based on the scope. Delegates to {@link ExperimentCellPlanService}. */
export const generateCells = (
  state: Pick<EvaluationsV3State, "datasets" | "activeDatasetId" | "targets" | "evaluators">,
  datasetRows: Array<Record<string, unknown>>,
  scope: ExecutionScope,
  options: { seedTargetOutputs?: Record<string, SeededTargetOutput> } = {},
): ExecutionCell[] =>
  cellPlan.generateCells({
    state,
    datasetRows,
    scope,
    seedTargetOutputs: options.seedTargetOutputs,
  });

/** How many cells a scope will dispatch, before the run starts. Delegates to {@link ExperimentCellPlanService}. */
export const countScopedCells = ({
  state,
  datasetRows,
  scope,
  seedTargetOutputs,
}: {
  state: Pick<EvaluationsV3State, "datasets" | "activeDatasetId" | "targets" | "evaluators">;
  datasetRows: Array<Record<string, unknown>>;
  scope: ExecutionScope;
  seedTargetOutputs?: Record<string, SeededTargetOutput>;
}): number => cellPlan.countScopedCells({ state, datasetRows, scope, seedTargetOutputs });

const comparisonPlan = ({
  loadedPrompts,
  loadedEvaluators,
}: {
  loadedPrompts?: Map<string, VersionedPrompt>;
  loadedEvaluators?: LoadedEvaluators;
}) => ExperimentComparisonPlanService.create({ loadedPrompts, loadedEvaluators });

/** Re-exported so it moved with its owner without duplicating the type. */
export type { ComparisonSkipReason } from "../processes/experiment-comparison-skip.process";

/** "a", "a and b", "a, b and c" — for the skip-reason message. Delegates to the comparison-skip process. */
export const formatList = (names: string[]): string => processFormatList(names);

/** The row-level error copy for a skipped comparison. Delegates to the comparison-skip process. */
export const comparisonSkipMessage = (
  reason: Pick<ComparisonSkipReason, "kind" | "variantNames">,
): { detail: string; errorType: string } => processComparisonSkipMessage(reason);

/** Phase 2 generator for comparison evaluators. Delegates to {@link ExperimentComparisonPlanService}. */
export const generateComparisonCells = ({
  state,
  datasetRows,
  completedTargetOutputs,
  completedTargetEvaluatorScores,
  loadedPrompts,
  loadedEvaluators,
  scopedRowIndices,
}: {
  state: Pick<EvaluationsV3State, "datasets" | "activeDatasetId" | "targets" | "evaluators">;
  datasetRows: Array<Record<string, unknown>>;
  completedTargetOutputs: Map<string, SeededTargetOutput>;
  completedTargetEvaluatorScores?: Map<string, VariantEvaluatorScore[]>;
  loadedPrompts?: Map<string, VersionedPrompt>;
  loadedEvaluators?: LoadedEvaluators;
  scopedRowIndices: number[] | undefined;
}): { cells: ExecutionCell[]; skipReasons: ComparisonSkipReason[] } =>
  comparisonPlan({ loadedPrompts, loadedEvaluators }).generateComparisonCells({
    state,
    datasetRows,
    completedTargetOutputs,
    completedTargetEvaluatorScores,
    scopedRowIndices,
  });

const sandboxKey = ExperimentRunSandboxKeyService.create();

/** Mints the run's sandbox credential, when a target executes code. Delegates to {@link ExperimentRunSandboxKeyService}. */
async function mintRunSandboxApiKey({
  sandboxCredentials,
  projectId,
  loadedAgents,
  loadedWorkflows,
}: {
  sandboxCredentials: ExperimentSandboxCredentialPort;
  projectId: string;
  loadedAgents: Map<string, TypedAgent>;
  loadedWorkflows?: Map<string, LoadedWorkflow>;
}): Promise<string | undefined> {
  return sandboxKey.mintRunSandboxApiKey({
    sandboxCredentials,
    projectId,
    loadedAgents,
    loadedWorkflows,
  });
}

const cellExecution = (ports: ExperimentRunPorts, workflows: WorkflowService) =>
  ExperimentCellExecutionService.create({ ports, workflows });

/**
 * Prices an LLM node's token usage at the project's canonical model rate.
 * Kept as its own tiny implementation (not a delegation) — it only reaches
 * `cost`, and {@link ExperimentCellExecutionService} is built from the
 * full port bag plus a workflow service this call site does not have.
 */
export const priceMetrics = async (
  cost: ExperimentModelCostPort,
  projectId: string,
  metrics: ExecutionState["metrics"] | undefined,
): Promise<number | undefined> => {
  if (!metrics?.model) return undefined;
  const inputTokens = metrics.prompt_tokens ?? 0;
  const outputTokens = metrics.completion_tokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return undefined;
  return cost.tryPriceTokens({ projectId, model: metrics.model, inputTokens, outputTokens });
};

/** Executes a single cell and yields events. Delegates to {@link ExperimentCellExecutionService}. */
export async function* executeCell(
  cell: ExecutionCell,
  projectId: string,
  ports: ExperimentRunPorts,
  datasetColumns: Array<{ id: string; name: string; type: string }>,
  loadedData: LoadedCellData,
  workflows: WorkflowService,
  resultMapperConfig?: ResultMapperConfig,
  isAborted?: () => Promise<boolean>,
): AsyncGenerator<EvaluationV3Event> {
  yield* cellExecution(ports, workflows).executeCell({
    cell,
    projectId,
    datasetColumns,
    loadedData,
    resultMapperConfig,
    isAborted,
  });
}

const workflowCell = (ports: ExperimentRunPorts, workflows: WorkflowService) =>
  ExperimentWorkflowCellService.create({
    ports,
    workflows,
    cells: cellExecution(ports, workflows),
  });

/** Executes a single cell whose target is a whole studio workflow. Delegates to {@link ExperimentWorkflowCellService}. */
export async function* executeWorkflowCell({
  cell,
  projectId,
  workflowDsl,
  datasetColumns = [],
  loadedEvaluators,
  resultMapperConfig,
  isAborted,
  ports,
  workflows,
  sandboxApiKey,
}: {
  cell: ExecutionCell;
  projectId: string;
  workflowDsl: StudioWorkflow;
  datasetColumns?: Array<{ id: string; name: string; type: string }>;
  loadedEvaluators?: LoadedEvaluators;
  resultMapperConfig?: ResultMapperConfig;
  isAborted?: () => Promise<boolean>;
  ports: ExperimentRunPorts;
  workflows: WorkflowService;
  /** The run's agent cache credential, when it minted one. */
  sandboxApiKey?: string;
}): AsyncGenerator<EvaluationV3Event> {
  yield* workflowCell(ports, workflows).executeWorkflowCell({
    cell,
    projectId,
    workflowDsl,
    datasetColumns,
    loadedEvaluators,
    resultMapperConfig,
    isAborted,
    sandboxApiKey,
  });
}

/** One turn to a connected agent, as the cell executor asks for it. */
export type ConnectedDispatch = (params: {
  projectId: string;
  agent: DispatchAgent;
  call: DispatchCall;
  signal: AbortSignal;
}) => Promise<CallOutcome>;

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
  ports: ExperimentRunPorts;
  workflows: WorkflowService;
}

/**
 * Executes a single cell whose target is a connected agent (ADR-128): one
 * turn through the relay dispatcher, since the agent runs in the
 * customer's own process. Each row is its own conversation, no history carried.
 * Delegates to {@link ExperimentConnectedCellService}.
 */
export async function* executeConnectedCell(
  input: ConnectedCellInput,
): AsyncGenerator<EvaluationV3Event> {
  const { ports, workflows, dispatch, sleep, now, ...cellInput } = input;
  yield* ExperimentConnectedCellService.create({
    ports,
    workflows,
    cells: cellExecution(ports, workflows),
    dispatch,
    sleep,
    now,
  }).executeConnectedCell(cellInput);
}

const evaluatorInputSvc = ExperimentEvaluatorInputService.create({});

/** The `error_type` a row carries when an evaluator resolved no input at all. */
export const NO_INPUTS_RESOLVED = "NoInputsResolved";

/** Builds the per-evaluator dispatch input. Delegates to {@link ExperimentEvaluatorInputService}. */
export const buildEvaluatorInputs = (
  cell: ExecutionCell,
  evaluatorId: string,
  targetOutput: Record<string, unknown>,
): Record<string, unknown> =>
  evaluatorInputSvc.buildEvaluatorInputs({ cell, evaluatorId, targetOutput });

/** What the row calls the evaluator column that could not run. Delegates to {@link ExperimentEvaluatorInputService}. */
export const evaluatorTargetDisplayName = ({
  target,
  loadedEvaluators,
}: {
  target: TargetConfig;
  loadedEvaluators?: LoadedEvaluators;
}): string =>
  ExperimentEvaluatorInputService.create({ loadedEvaluators }).evaluatorTargetDisplayName({
    target,
  });

/** Whether dispatching this evaluator COLUMN would hand it nothing to read. Delegates to {@link ExperimentEvaluatorInputService}. */
export const evaluatorTargetHasNoResolvedInputs = ({
  cell,
  loadedEvaluators,
}: {
  cell: ExecutionCell;
  loadedEvaluators?: LoadedEvaluators;
}): boolean =>
  ExperimentEvaluatorInputService.create({ loadedEvaluators }).evaluatorTargetHasNoResolvedInputs({
    cell,
  });

/** Whether dispatching would hand the evaluator nothing to read. Delegates to {@link ExperimentEvaluatorInputService}. */
export const hasNoResolvedInputs = ({
  cell,
  evaluator,
  inputs,
}: {
  cell: ExecutionCell;
  evaluator: EvaluatorConfig;
  inputs: Record<string, unknown>;
}): boolean => evaluatorInputSvc.hasNoResolvedInputs({ cell, evaluator, inputs });

const resultDispatches = ExperimentResultDispatchService.create();

/** Build the per-target metadata stored with a run. Delegates to {@link ExperimentResultDispatchService}. */
export const buildTargetMetadata = (
  input: Parameters<ExperimentResultDispatchService["buildTargetMetadata"]>[0],
): ESBatchEvaluationTarget[] => resultDispatches.buildTargetMetadata(input);

/** Build the recordTargetResult dispatch payload. Delegates to {@link ExperimentResultDispatchService}. */
export const buildTargetResultDispatch = (
  input: Parameters<ExperimentResultDispatchService["tryBuildTargetResultDispatch"]>[0],
): RecordTargetResultCommandData | null => resultDispatches.tryBuildTargetResultDispatch(input);

/** Build the recordEvaluatorResult dispatch payload. Delegates to {@link ExperimentResultDispatchService}. */
export const buildEvaluatorResultDispatch = (
  input: Parameters<ExperimentResultDispatchService["buildEvaluatorResultDispatch"]>[0],
): RecordEvaluatorResultCommandData => resultDispatches.buildEvaluatorResultDispatch(input);

const carriedBoard = ExperimentCarriedBoardService.create({ dispatches: resultDispatches });

/**
 * Build the stored rows for board cells a run carries rather than
 * produces. Delegates to {@link ExperimentCarriedBoardService}.
 */
export const buildCarriedOverDispatches = (
  input: Parameters<ExperimentCarriedBoardService["buildCarriedOverDispatches"]>[0],
): ReturnType<ExperimentCarriedBoardService["buildCarriedOverDispatches"]> =>
  carriedBoard.buildCarriedOverDispatches(input);

/** Main orchestrator: executes all cells and yields SSE events, with parallel execution under a semaphore. */
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
    defaultConcurrency,
    concurrency: requestedConcurrency,
    seedTargetOutputs,
    carriedOverCells,
    ports,
    workflows,
    actor,
  } = input;

  // A personal development agent runs on one person's own machine, so only
  // that person may send it a turn. Refused before any cell exists, the way a
  // simulation refuses it when the run is scheduled.
  await assertConnectedAgentsRunnable({
    agents: [...loadedAgents.values()],
    actor,
  });

  const concurrency = requestedConcurrency ?? defaultConcurrency;

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
  await ports.abort.setRunning({ runId, projectId });

  // The canonical Experiment service owns the Eventing command dispatch.
  const commands = ports.experiments;

  // Owns the run's CH/evaluation-pipeline writes and the per-(row, target)
  // caches Phase 2 reads. Delegates to {@link ExperimentRunStorageService}.
  const storage = ExperimentRunStorageService.create({
    commands,
    evaluationReporting: ports.evaluationReporting,
    dispatches: resultDispatches,
    cells,
    seedTargetOutputs,
  });

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
    sandboxCredentials: ports.sandboxCredentials,
    projectId,
    loadedAgents,
    loadedWorkflows,
  });

  // Dispatch event to ClickHouse.
  if (experimentId) {
    try {
      await storage.startRun({
        projectId,
        runId,
        experimentId,
        workflowVersionId,
        totalCells,
        targets: targetMetadata,
      });
    } catch (err) {
      await ports.abort.clearRunning(runId);
      throw err;
    }

    await ExperimentCarriedBoardService.create({
      commands,
      dispatches: resultDispatches,
    }).recordCarriedOverBoard({
      projectId,
      runId,
      experimentId,
      cells: carriedOverCells ?? [],
      datasetRows,
      state,
      loadedEvaluators,
    });
  }

  // Mirrors an event to storage: caches, evaluation reporting, ClickHouse.
  // Delegates to {@link ExperimentRunStorageService}.
  const processEventForStorage = (event: EvaluationV3Event) =>
    storage.record({ event, projectId, runId, experimentId, state, loadedEvaluators, datasetRows });

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

  logger.info({ runId, totalCells, concurrency, experimentId }, "Starting evaluation execution");

  let completed = 0;

  // Delivers events to the caller as parallel cells complete. Delegates to
  // {@link createEventStream}.
  const { pushEvent, signalComplete, waitForEvent } = createEventStream();

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
        if (await ports.abort.isAborted(runId)) {
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
            if (await ports.abort.isAborted(runId)) {
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
            const checkAbort = () => ports.abort.isAborted(runId);

            // Pick the executor: a workflow target (or an agent wrapping a
            // Studio workflow) runs via execute_flow once per row; every
            // other target runs a single component.
            const runsAsWorkflow =
              (cell.targetConfig.type === "workflow" ||
                (cell.targetConfig.type === "agent" && loadedData.agent?.type === "workflow")) &&
              !!loadedData.workflow;

            // A connected agent has no node in the engine: it runs in the
            // customer's own process and is reached through the relay.
            const connectedAgent =
              cell.targetConfig.type === "agent" && loadedData.agent?.type === "connected"
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
                  ports,
                  workflows,
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
                    ports,
                    workflows,
                    sandboxApiKey,
                  })
                : executeCell(
                    cell,
                    projectId,
                    ports,
                    datasetColumns,
                    loadedData,
                    workflows,
                    resultMapperConfig,
                    checkAbort,
                  );

            // Execute cell and collect events
            let cellFailed = false;
            let cellAborted = false;
            for await (const event of cellEvents) {
              // Check abort during cell processing
              if (await ports.abort.isAborted(runId)) {
                cellAborted = true;
                break;
              }

              pushEvent(event);

              // Process for storage
              await processEventForStorage(event);

              // Track failures
              if (event.type === "error" || (event.type === "target_result" && event.error)) {
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

      // Phase 2: pairwise (#5100) + N-way select-best (#5101) cells,
      // generated after Phase 1 so each has its variants' outputs. New
      // cells append to totalCells so progress stays honest. An
      // `evaluator`/`evaluator-all-rows` scope seeds nothing, so Phase 2
      // has no comparison work in it even though every row is in scope.
      const scopeCanProduceVariantOutputs =
        scope.type !== "evaluator" && scope.type !== "evaluator-all-rows";

      if (!aborted && scopeCanProduceVariantOutputs) {
        const { cells: phase2Cells, skipReasons } = generateComparisonCells({
          state,
          datasetRows,
          completedTargetOutputs: storage.outputs,
          completedTargetEvaluatorScores: storage.evaluatorScores,
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

        // Emit a synthetic evaluator_result error event per skipped row, so
        // the comparison column doesn't sit at "No verdict yet" forever.
        // pushEvent updates the UI immediately; processEventForStorage also
        // writes it to ClickHouse.
        for (const reason of skipReasons) {
          // Respect user-triggered abort mid-loop; otherwise a long skip-reason
          // burst would keep writing to CH after the run was meant to stop.
          if (await ports.abort.isAborted(runId)) {
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

        // Back-fill the candidate outputs this run REUSED rather than
        // executed (#5789 fix 2): such a run stores only the judge's
        // verdict, so the Results view showed "No results to display" with
        // $0 cost. Re-record what was compared, carrying over the seeded
        // cost/duration so per-target headers aren't blank.
        if (phase2Cells.length > 0 && seedTargetOutputs) {
          const rowsThisRunOwns = new Set(
            resolveScopedRowIndices({ scope, rowCount: datasetRows.length }),
          );
          for (const [key, seeded] of Object.entries(seedTargetOutputs)) {
            if (storage.hasProduced(key)) continue;
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
            if (await ports.abort.isAborted(runId)) {
              aborted = true;
              break;
            }
            await semaphore.acquire();

            const cellPromise = (async () => {
              try {
                if (await ports.abort.isAborted(runId)) return;

                const loadedData = {
                  ...getLoadedDataForTarget(cell.targetConfig, loadedPrompts, loadedAgents),
                  evaluators: loadedEvaluators,
                  sandboxApiKey,
                };

                const checkAbort = () => ports.abort.isAborted(runId);

                let cellFailed = false;
                for await (const event of executeCell(
                  cell,
                  projectId,
                  ports,
                  datasetColumns,
                  loadedData,
                  workflows,
                  resultMapperConfig,
                  checkAbort,
                )) {
                  if (await ports.abort.isAborted(runId)) break;
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
      logger.info({ runId, completedCells, totalCells }, "Emitting stopped event");
      yield {
        type: "stopped",
        reason: "user",
      };
    }

    // Ensure processing is complete
    await processingPromise;
  } finally {
    // Clear running flag
    await ports.abort.clearRunning(runId);
    await ports.abort.clearAbort(runId);

    const finishedAt = Date.now();

    // Dispatch completion event to ClickHouse.
    if (experimentId) {
      await storage.completeRun({ projectId, runId, experimentId, aborted, finishedAt });
    }
  }

  // Log CH dispatch failure summary if any failed
  if (storage.dispatchFailures > 0) {
    logger.warn(
      {
        runId,
        chDispatchFailures: storage.dispatchFailures,
        chDispatchTotal: storage.dispatchTotal,
      },
      `${storage.dispatchFailures} of ${storage.dispatchTotal} CH dispatches failed for run ${runId}`,
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
      ...(storage.dispatchFailures > 0 && { chDispatchFailures: storage.dispatchFailures }),
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
      // workflow's id (see loadPublishedWorkflow).
      if (agent.type === "workflow") {
        const linkedWorkflowId =
          agent.workflowId ?? (agent.config as { workflow_id?: string }).workflow_id;
        const workflow = linkedWorkflowId
          ? loadedWorkflows?.get(workflowLoadKey({ workflowId: linkedWorkflowId }))
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
export const requestAbort = async ({
  abort,
  runId,
}: {
  abort: ExperimentRunAbortPort;
  runId: string;
}): Promise<void> => {
  await abort.requestAbort(runId);
};
