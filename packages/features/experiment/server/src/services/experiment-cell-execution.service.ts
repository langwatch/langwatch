/**
 * Runs one cell whose target is a studio component — a prompt, an HTTP or
 * code agent, or an evaluator run as its own column — and grades it. Owns
 * the evaluator dispatch loop the other two executors reuse: one
 * evaluator failing does not stop the rest, each reports its own error
 * cell, and the target's result is already yielded by then. Prices a
 * target's tokens at the project's canonical model rate, since the engine
 * reports token counts and has no price table.
 */

import type { ExecutionCell, EvaluationV3Event } from "@langwatch/experiment-contract";
import type {
  ExecutionState,
  StudioServerEvent,
  StudioWorkflow,
  WorkflowService,
} from "@langwatch/workflow-contract";
import type { Agent as TypedAgent } from "@langwatch/agent-contract";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import { createLogger } from "@langwatch/observability";
import { generateOtelTraceId } from "@langwatch/trace-contract";
import { buildCellWorkflow } from "../processes/experiment-cell-workflow.process";
import {
  mapNlpEvent,
  mapThrownErrorEvent,
  type ResultMapperConfig,
} from "../processes/experiment-result-mapping.process";
import {
  evaluatorErrorResult,
  evaluatorTargetNoInputsResult,
  noInputsResolvedResult,
} from "../processes/experiment-cell-error-events.process";
import type { ExperimentModelCostPort } from "../ports/experiment-model-cost.port";
import type { ExperimentRunPorts } from "./experiment-run-orchestrator.service";
import { ExperimentEvaluatorInputService } from "./experiment-evaluator-input.service";
import { ExperimentRunSandboxKeyService } from "./experiment-run-sandbox-key.service";
import type { LoadedEvaluators } from "./experiment-execution-data.service";

const sandboxKey = ExperimentRunSandboxKeyService.create();

const logger = createLogger("langwatch:experiment:run-orchestrator");

/** The per-cell loaded data `executeCell` needs beyond the cell itself. */
export type LoadedCellData = {
  prompt?: VersionedPrompt;
  agent?: TypedAgent;
  evaluators?: LoadedEvaluators;
  /** The run's agent cache credential, when it minted one. */
  sandboxApiKey?: string;
};

/** What every evaluator of a cell is dispatched against. */
type CellEvaluatorContext = {
  cell: ExecutionCell;
  projectId: string;
  workflow: StudioWorkflow;
  targetOutput: Record<string, unknown>;
  traceId: string;
  targetNodes: Set<string>;
  config: ResultMapperConfig;
  isAborted?: () => Promise<boolean>;
};

export class ExperimentCellExecutionService {
  static create({
    ports,
    workflows,
  }: {
    ports: ExperimentRunPorts;
    workflows: WorkflowService;
  }): ExperimentCellExecutionService {
    return new ExperimentCellExecutionService(ports, workflows);
  }

  private constructor(
    private readonly ports: ExperimentRunPorts,
    private readonly workflows: WorkflowService,
  ) {}

  /** Prices an LLM node's token usage at the project's canonical model rate. */
  async tryPriceMetrics({
    projectId,
    metrics,
  }: {
    projectId: string;
    metrics: ExecutionState["metrics"] | undefined;
  }): Promise<number | undefined> {
    if (!metrics?.model) {
      return undefined;
    }

    const inputTokens = metrics.prompt_tokens ?? 0;
    const outputTokens = metrics.completion_tokens ?? 0;
    if (inputTokens === 0 && outputTokens === 0) {
      return undefined;
    }

    return this.ports.cost.tryPriceTokens({
      projectId,
      model: metrics.model,
      inputTokens,
      outputTokens,
    });
  }

  private async *runOneCellEvaluator({
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
    const evaluatorInputSvc = ExperimentEvaluatorInputService.create({});
    const evaluatorInputs = evaluatorInputSvc.buildEvaluatorInputs({
      cell,
      evaluatorId,
      targetOutput,
    });

    // The dispatch decision. An evaluator whose every input resolved empty is
    // not run: it would score empty against empty and report that as a verdict.
    const evaluator = cell.evaluatorConfigs.find((e) => e.id === evaluatorId);
    if (
      evaluator &&
      evaluatorInputSvc.hasNoResolvedInputs({ cell, evaluator, inputs: evaluatorInputs })
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
        workflow: { ...workflow, state: { execution: { status: "idle" as const } } },
        node_id: evaluatorNodeId,
        inputs: evaluatorInputs,
        origin: "evaluation",
      },
    };

    const evaluatorEvents: StudioServerEvent[] = [];
    await this.ports.studio.postEvent({
      projectId,
      event: await this.workflows.enrichStudioEvent({ event: evaluatorEvent, projectId }),
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

  /**
   * Dispatches a cell's grading evaluators against the target's output,
   * shared by both executors. One evaluator failing does not stop the
   * rest — each reports its own error cell.
   */
  async *runCellEvaluators({
    evaluatorNodeIds,
    ...context
  }: CellEvaluatorContext & {
    evaluatorNodeIds: Record<string, string>;
  }): AsyncGenerator<EvaluationV3Event> {
    const { cell, isAborted } = context;

    for (const [evaluatorId, evaluatorNodeId] of Object.entries(evaluatorNodeIds)) {
      if (isAborted && (await isAborted())) {
        logger.debug(
          { cell: cell.rowIndex, evaluatorId },
          "Cell aborted before evaluator execution",
        );

        return;
      }

      try {
        yield* this.runOneCellEvaluator({ ...context, evaluatorId, evaluatorNodeId });
      } catch (evalError) {
        logger.warn(
          { error: evalError, evaluatorId, rowIndex: cell.rowIndex, targetId: cell.targetId },
          "Evaluator execution failed",
        );
        yield evaluatorErrorResult({ cell, evaluatorId, error: evalError });
      }
    }
  }

  /** The dispatch guard for an evaluator COLUMN with nothing mapped. */
  private *refuseUnmappedColumn({
    cell,
    loadedData,
  }: {
    cell: ExecutionCell;
    loadedData: LoadedCellData;
  }): Generator<EvaluationV3Event, boolean> {
    const cellEvaluatorInputs = ExperimentEvaluatorInputService.create({
      loadedEvaluators: loadedData.evaluators,
    });
    if (!cellEvaluatorInputs.evaluatorTargetHasNoResolvedInputs({ cell })) {
      return false;
    }

    const name = cellEvaluatorInputs.evaluatorTargetDisplayName({ target: cell.targetConfig });
    logger.info(
      { rowIndex: cell.rowIndex, targetId: cell.targetId, name },
      "Evaluator column not dispatched: every input resolved empty",
    );
    yield evaluatorTargetNoInputsResult({ cell, name });

    return true;
  }

  /** The precomputed-output branch: skip target execution and reshape the stored value. */
  private precomputedTargetOutput(cell: ExecutionCell): Record<string, unknown> {
    logger.debug(
      { rowIndex: cell.rowIndex, targetId: cell.targetId },
      "Skipping target execution, using pre-computed output",
    );
    if (typeof cell.precomputedTargetOutput === "object" && cell.precomputedTargetOutput !== null) {
      return cell.precomputedTargetOutput as Record<string, unknown>;
    }

    const outputField = cell.targetConfig.outputs?.[0]?.identifier ?? "output";

    return { [outputField]: cell.precomputedTargetOutput };
  }

  /** Dispatches the target node and yields its mapped events, pricing untariffed tokens. */
  private async *dispatchTarget({
    cell,
    projectId,
    workflow,
    targetNodeId,
    loadedData,
    targetNodes,
    cellConfig,
    traceId,
    isAborted,
  }: {
    cell: ExecutionCell;
    projectId: string;
    workflow: StudioWorkflow;
    targetNodeId: string;
    loadedData: LoadedCellData;
    targetNodes: Set<string>;
    cellConfig: ResultMapperConfig;
    traceId: string;
    isAborted?: () => Promise<boolean>;
  }): AsyncGenerator<
    EvaluationV3Event,
    { targetOutput?: Record<string, unknown>; targetFailed: boolean }
  > {
    const evaluatorInputSvc = ExperimentEvaluatorInputService.create({});
    const rawEvent = {
      type: "execute_component" as const,
      payload: {
        trace_id: traceId,
        workflow: { ...workflow, state: { execution: { status: "idle" as const } } },
        node_id: targetNodeId,
        inputs: evaluatorInputSvc.buildTargetInputs({ cell }),
        origin: "evaluation",
      },
    };

    // Prepare runtime credentials and datasets, then set the run's own
    // sandbox credential on the workflow so its code nodes authenticate.
    const enrichedEvent = sandboxKey.withSandboxApiKey(
      await this.workflows.prepareStudioEvent({ event: rawEvent, projectId }),
      loadedData.sandboxApiKey,
    );

    let targetOutput: Record<string, unknown> | undefined;
    let targetFailed = false;
    const targetEvents: StudioServerEvent[] = [];

    await this.ports.studio.postEvent({
      projectId,
      event: enrichedEvent,
      isAborted,
      onEvent: (serverEvent) => {
        targetEvents.push(serverEvent);
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

    for (const event of targetEvents) {
      const mappedEvent = mapNlpEvent({
        event,
        rowIndex: cell.rowIndex,
        targetNodes,
        config: cellConfig,
      });
      if (!mappedEvent) {
        continue;
      }

      // The engine reports token usage but no cost (it has no price table),
      // so price the target's tokens here at the canonical model rate. This
      // keeps the cell's cost consistent with its trace's cost.
      if (
        mappedEvent.type === "target_result" &&
        mappedEvent.cost == null &&
        event.type === "component_state_change"
      ) {
        const cost = await this.tryPriceMetrics({
          projectId,
          metrics: event.payload.execution_state?.metrics,
        });
        if (cost != null) {
          mappedEvent.cost = cost;
        }
      }

      yield mappedEvent;
    }

    return { targetOutput, targetFailed };
  }

  /** Executes a single cell and yields events. */
  async *executeCell({
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
    loadedData: LoadedCellData;
    resultMapperConfig?: ResultMapperConfig;
    isAborted?: () => Promise<boolean>;
  }): AsyncGenerator<EvaluationV3Event> {
    yield { type: "cell_started", rowIndex: cell.rowIndex, targetId: cell.targetId };

    try {
      const refused = yield* this.refuseUnmappedColumn({ cell, loadedData });
      if (refused) {
        return;
      }

      const { workflow, targetNodeId, evaluatorNodeIds } = buildCellWorkflow(
        { projectId, cell, datasetColumns },
        loadedData,
      );

      const targetNodes = new Set([cell.targetId]);
      const cellConfig: ResultMapperConfig = {
        ...resultMapperConfig,
        evaluatorTargetNodeIds:
          cell.targetConfig.type === "evaluator" ? new Set([cell.targetId]) : undefined,
      };
      const traceId = cell.traceId ?? generateOtelTraceId();

      let targetOutput: Record<string, unknown> | undefined;
      let targetFailed = false;

      if (cell.skipTarget && cell.precomputedTargetOutput !== undefined) {
        targetOutput = this.precomputedTargetOutput(cell);
      } else {
        const result = yield* this.dispatchTarget({
          cell,
          projectId,
          workflow,
          targetNodeId,
          loadedData,
          targetNodes,
          cellConfig,
          traceId,
          isAborted,
        });
        targetOutput = result.targetOutput;
        targetFailed = result.targetFailed;
      }

      if (isAborted && (await isAborted())) {
        logger.debug(
          { cell: cell.rowIndex, targetId: cell.targetId },
          "Cell aborted after target execution",
        );

        return;
      }

      if (!targetFailed && targetOutput && Object.keys(evaluatorNodeIds).length > 0) {
        yield* this.runCellEvaluators({
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
      yield mapThrownErrorEvent({ error, rowIndex: cell.rowIndex, targetId: cell.targetId });
    }
  }
}
