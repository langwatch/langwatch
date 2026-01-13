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

import { nanoid } from "nanoid";
import { buildCellWorkflow } from "./workflowBuilder";
import { mapNlpEvent, mapErrorEvent, type ResultMapperConfig } from "./resultMapper";
import { buildStripScoreEvaluatorIds } from "./evaluatorScoreFilter";
import { abortManager } from "./abortManager";
import { createSemaphore } from "./semaphore";
import { generateHumanReadableId } from "~/utils/humanReadableId";
import type {
  ExecutionScope,
  ExecutionCell,
  EvaluationV3Event,
  ExecutionSummary,
} from "./types";
import type { EvaluationsV3State, TargetConfig } from "~/evaluations-v3/types";
import { isRowEmpty } from "~/evaluations-v3/utils/emptyRowDetection";
import type { StudioServerEvent } from "~/optimization_studio/types/events";
import { addEnvs } from "~/optimization_studio/server/addEnvs";
import { loadDatasets } from "~/optimization_studio/server/loadDatasets";
import { studioBackendPostEvent } from "~/app/api/workflows/post_event/post-event";
import { createLogger } from "~/utils/logger";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import type { TypedAgent } from "~/server/agents/agent.repository";
import type { BatchEvaluationRepository, DatasetEntry, EvaluationEntry } from "../repositories/batchEvaluation.repository";
import { getDefaultBatchEvaluationRepository } from "../repositories/elasticsearchBatchEvaluation.repository";
import type { ESBatchEvaluationTarget } from "~/server/experiments/types";
import type { SingleEvaluationResult } from "~/server/evaluations/evaluators.generated";

const logger = createLogger("evaluations-v3:orchestrator");

// Default concurrency limit (can be overridden via environment variable)
const DEFAULT_CONCURRENCY = parseInt(process.env.EVAL_V3_CONCURRENCY ?? "5", 10);

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
  /** Enable saving results to Elasticsearch */
  saveToEs?: boolean;
};

/**
 * Generates all cells to execute based on the scope.
 */
export const generateCells = (
  state: Pick<EvaluationsV3State, "datasets" | "activeDatasetId" | "targets" | "evaluators">,
  datasetRows: Array<Record<string, unknown>>,
  scope: ExecutionScope
): ExecutionCell[] => {
  const cells: ExecutionCell[] = [];
  const datasetId = state.datasets[0]?.id ?? state.activeDatasetId ?? "dataset-1";

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

  // Determine which targets to process
  const targetIds =
    scope.type === "full"
      ? state.targets.map((t: TargetConfig) => t.id)
      : scope.type === "rows"
        ? state.targets.map((t: TargetConfig) => t.id)
        : scope.type === "target"
          ? [scope.targetId]
          : scope.type === "cell"
            ? [scope.targetId]
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
      const targetConfig = state.targets.find((t: TargetConfig) => t.id === targetId);
      if (!targetConfig) continue;

      cells.push({
        rowIndex,
        targetId,
        targetConfig,
        evaluatorConfigs: state.evaluators,
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
 * Executes a single cell and yields events.
 * @param isAborted - Optional function to check if execution should be aborted
 */
export async function* executeCell(
  cell: ExecutionCell,
  projectId: string,
  datasetColumns: Array<{ id: string; name: string; type: string }>,
  loadedData: { prompt?: VersionedPrompt; agent?: TypedAgent },
  resultMapperConfig?: ResultMapperConfig,
  isAborted?: () => Promise<boolean>
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
      loadedData
    );

    // Create set of target nodes for the result mapper
    const targetNodes = new Set([cell.targetId]);

    // Create the execute_component event for the target
    const traceId = `trace_${nanoid()}`;
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
      },
    };

    // Add environment variables and process datasets
    const enrichedEvent = await loadDatasets(
      await addEnvs(rawEvent, projectId),
      projectId
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
      const mappedEvent = mapNlpEvent(event, cell.rowIndex, targetNodes, resultMapperConfig);
      if (mappedEvent) {
        yield mappedEvent;
      }
    }

    // Check abort before executing evaluators
    if (isAborted && await isAborted()) {
      logger.debug({ cell: cell.rowIndex, targetId: cell.targetId }, "Cell aborted after target execution");
      return;
    }

    // Execute evaluators if target succeeded and we have evaluators
    if (!targetFailed && targetOutput && Object.keys(evaluatorNodeIds).length > 0) {
      for (const [evaluatorId, evaluatorNodeId] of Object.entries(evaluatorNodeIds)) {
        // Check abort before each evaluator
        if (isAborted && await isAborted()) {
          logger.debug({ cell: cell.rowIndex, evaluatorId }, "Cell aborted before evaluator execution");
          return;
        }
        try {
          // Build evaluator inputs from target output and dataset
          const evaluatorInputs = buildEvaluatorInputs(
            cell,
            evaluatorId,
            targetOutput
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
            const mappedEvent = mapNlpEvent(event, cell.rowIndex, targetNodes, resultMapperConfig);
            if (mappedEvent) {
              yield mappedEvent;
            }
          }
        } catch (evalError) {
          // Yield error for this evaluator but continue with others
          logger.warn(
            { error: evalError, evaluatorId, cell },
            "Evaluator execution failed"
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
    logger.error({ error, cell }, "Cell execution failed");
    yield mapErrorEvent(
      (error as Error).message,
      cell.rowIndex,
      cell.targetId
    );
  }
}

/**
 * Builds the input values for an evaluator from target output and dataset entry.
 */
const buildEvaluatorInputs = (
  cell: ExecutionCell,
  evaluatorId: string,
  targetOutput: Record<string, unknown>
): Record<string, unknown> => {
  const inputs: Record<string, unknown> = {};
  const datasetId = cell.datasetEntry._datasetId as string | undefined;
  if (!datasetId) return inputs;

  // Find the evaluator config
  const evaluator = cell.evaluatorConfigs.find((e) => e.id === evaluatorId);
  if (!evaluator) return inputs;

  // Get mappings for this dataset and target
  const mappings = evaluator.mappings[datasetId]?.[cell.targetId] ?? {};

  for (const [inputField, mapping] of Object.entries(mappings)) {
    if (mapping.type === "source") {
      if (mapping.source === "dataset") {
        // From dataset entry
        inputs[inputField] = cell.datasetEntry[mapping.sourceField];
      } else if (mapping.source === "target" && mapping.sourceId === cell.targetId) {
        // From target output
        inputs[inputField] = targetOutput[mapping.sourceField];
      }
    } else if (mapping.type === "value") {
      inputs[inputField] = mapping.value;
    }
  }

  return inputs;
}

/**
 * Builds the input values for a target from the cell's dataset entry.
 */
const buildTargetInputs = (cell: ExecutionCell): Record<string, unknown> => {
  const inputs: Record<string, unknown> = {};
  const datasetId = cell.datasetEntry._datasetId as string | undefined;
  if (!datasetId) return inputs;

  const mappings = cell.targetConfig.mappings[datasetId] ?? {};
  for (const [inputField, mapping] of Object.entries(mappings)) {
    if (mapping.type === "source" && mapping.source === "dataset") {
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
  input: OrchestratorInput
): AsyncGenerator<EvaluationV3Event> {
  // Generate a human-readable run ID like "swift-fox-42"
  const runId = generateHumanReadableId();
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
    saveToEs = false,
  } = input;

  // Generate cells to execute
  const cells = generateCells(state, datasetRows, scope);
  const totalCells = cells.length;

  logger.info({ runId, totalCells, scope, saveToEs }, "Starting orchestrator");

  // Set running flag
  await abortManager.setRunning(runId);

  // Get repository and initialize storage if enabled
  const repository = saveToEs && experimentId ? getDefaultBatchEvaluationRepository() : null;

  // Accumulate results for batch saving
  const pendingDataset: DatasetEntry[] = [];
  const pendingEvaluations: EvaluationEntry[] = [];
  let pendingProgress = 0;
  let lastSaveTime = Date.now();
  const SAVE_INTERVAL = 5000; // Save every 5 seconds
  const SAVE_THRESHOLD = 10; // Or every 10 events

  // Build target metadata for storage
  const targetMetadata: ESBatchEvaluationTarget[] = state.targets.map((t) => ({
    id: t.id,
    name: t.name,
    type: t.type,
    prompt_id: t.promptId ?? null,
    prompt_version: t.promptVersionNumber ?? null,
    agent_id: t.dbAgentId ?? null,
    model: t.localPromptConfig?.llm?.model ?? null,
  }));

  // Build config for result mapper - determines which evaluators have scores stripped
  const resultMapperConfig: ResultMapperConfig = {
    stripScoreEvaluatorIds: buildStripScoreEvaluatorIds(state.evaluators),
  };

  // Create initial record in storage
  if (repository && experimentId) {
    await repository.create({
      projectId,
      experimentId,
      runId,
      workflowVersionId,
      total: totalCells,
      targets: targetMetadata,
    });
  }

  // Helper to save pending results
  const savePendingResults = async (force = false) => {
    if (!repository || !experimentId) return;

    const now = Date.now();
    const shouldSave = force ||
      pendingDataset.length + pendingEvaluations.length >= SAVE_THRESHOLD ||
      now - lastSaveTime >= SAVE_INTERVAL;

    if (shouldSave && (pendingDataset.length > 0 || pendingEvaluations.length > 0)) {
      await repository.upsertResults({
        projectId,
        experimentId,
        runId,
        dataset: [...pendingDataset],
        evaluations: [...pendingEvaluations],
        progress: pendingProgress,
      });
      pendingDataset.length = 0;
      pendingEvaluations.length = 0;
      lastSaveTime = Date.now();
    }
  };

  // Helper to process event for storage
  const processEventForStorage = (event: EvaluationV3Event) => {
    if (!repository) return;

    if (event.type === "target_result") {
      // Get the dataset row entry for this row index
      const datasetEntry = datasetRows[event.rowIndex] ?? {};
      
      pendingDataset.push({
        index: event.rowIndex,
        target_id: event.targetId,
        entry: datasetEntry,
        predicted: event.output ? { output: event.output } : undefined,
        cost: event.cost ?? null,
        duration: event.duration ?? null,
        error: event.error ?? null,
        trace_id: event.traceId ?? null,
      });
    } else if (event.type === "evaluator_result") {
      const result = event.result as SingleEvaluationResult;
      pendingEvaluations.push({
        evaluator: event.evaluatorId,
        target_id: event.targetId,
        index: event.rowIndex,
        status: result.status,
        score: result.status === "processed" ? result.score : null,
        label: result.status === "processed" ? result.label : null,
        passed: result.status === "processed" ? result.passed : null,
        details: result.status === "error" ? result.details : (result.status === "processed" ? result.details : null),
        cost: result.status === "processed" && result.cost ? result.cost.amount : null,
      });
    } else if (event.type === "progress") {
      pendingProgress = event.completed;
    }

    // Fire-and-forget save check
    void savePendingResults();
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
  const semaphore = createSemaphore(DEFAULT_CONCURRENCY);

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
            const loadedData = getLoadedDataForTarget(cell.targetConfig, loadedPrompts, loadedAgents);

            // Create abort checker bound to this run
            const checkAbort = () => abortManager.isAborted(runId);

            // Execute cell and collect events
            let cellFailed = false;
            let cellAborted = false;
            for await (const event of executeCell(cell, projectId, datasetColumns, loadedData, resultMapperConfig, checkAbort)) {
              // Check abort during cell processing
              if (await abortManager.isAborted(runId)) {
                cellAborted = true;
                break;
              }

              pushEvent(event);

              // Process for storage
              processEventForStorage(event);

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
            processEventForStorage(progressEvent);
          } finally {
            semaphore.release();
          }
        })();

        activeCells.add(cellPromise);
        cellPromise.finally(() => activeCells.delete(cellPromise));
      }

      // Wait for all remaining cells to complete
      await Promise.all(activeCells);
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

    // Save any remaining results and mark complete
    const finishedAt = Date.now();
    if (repository && experimentId) {
      try {
        // Save any pending results
        await savePendingResults(true);

        // Mark as complete or stopped
        await repository.markComplete({
          projectId,
          experimentId,
          runId,
          finishedAt: aborted ? undefined : finishedAt,
          stoppedAt: aborted ? finishedAt : undefined,
        });
      } catch (error) {
        logger.error({ error, runId }, "Failed to save final results to storage");
      }
    }
  }

  // Only emit done if not aborted
  if (!aborted) {
    const finishedAt = Date.now();

    // Emit done with summary
    const summary: ExecutionSummary = {
      runId,
      totalCells,
      completedCells,
      failedCells,
      duration: finishedAt - startTime,
      timestamps: {
        startedAt: startTime,
        finishedAt,
      },
    };

    yield {
      type: "done",
      summary,
    };
  }
}

/**
 * Gets loaded prompt/agent data for a target.
 */
const getLoadedDataForTarget = (
  targetConfig: TargetConfig,
  loadedPrompts: Map<string, VersionedPrompt>,
  loadedAgents: Map<string, TypedAgent>
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
