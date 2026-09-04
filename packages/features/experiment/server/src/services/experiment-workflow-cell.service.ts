/**
 * Runs one cell whose target is a whole committed Studio workflow. The
 * row goes through `execute_flow` once, the End node's result becomes
 * the target output, each of the workflow's own evaluator nodes becomes
 * an evaluator result under the node's display name, and node costs are
 * summed with LLM nodes priced the same way `executeCell` prices them.
 * Evaluators attached to the column are then graded through S4's loop,
 * only when the workflow produced a result.
 */

import {
  nodeErrorToDomainError,
  type StudioServerEvent,
  type StudioWorkflow,
  type WorkflowService,
} from "@langwatch/workflow-contract";
import {
  UNNAMED_FAILURE,
  type EvaluationV3Event,
  type ExecutionCell,
} from "@langwatch/experiment-contract";
import { generateOtelTraceId } from "@langwatch/trace-contract";
import { createLogger } from "@langwatch/observability";
import { buildEvaluatorCellWorkflow } from "../processes/experiment-cell-workflow.process";
import {
  extractTargetOutput,
  mapThrownErrorEvent,
  mapWorkflowEvaluatorResult,
  type ResultMapperConfig,
} from "../processes/experiment-result-mapping.process";
import { ExperimentEvaluatorInputService } from "./experiment-evaluator-input.service";
import type { ExperimentCellExecutionService } from "./experiment-cell-execution.service";
import type { ExperimentRunPorts } from "./experiment-run-orchestrator.service";
import { ExperimentRunSandboxKeyService } from "./experiment-run-sandbox-key.service";
import type { LoadedEvaluators } from "./experiment-execution-data.service";

const logger = createLogger("langwatch:experiment:run-orchestrator");
const sandboxKey = ExperimentRunSandboxKeyService.create();

type FoldedFlowState = {
  targetOutput: unknown;
  targetOutputRecord: Record<string, unknown> | undefined;
  totalCost: number;
  sawCost: boolean;
  targetFailed: boolean;
  targetFailure: { error?: string; errorType?: string; upstreamStatus?: number } | undefined;
  durationMs: number | undefined;
  finalTraceId: string;
  evaluatorEvents: EvaluationV3Event[];
};

export class ExperimentWorkflowCellService {
  static create({
    ports,
    workflows,
    cells,
  }: {
    ports: ExperimentRunPorts;
    workflows: WorkflowService;
    cells: ExperimentCellExecutionService;
  }): ExperimentWorkflowCellService {
    return new ExperimentWorkflowCellService(ports, workflows, cells);
  }

  private constructor(
    private readonly ports: ExperimentRunPorts,
    private readonly workflows: WorkflowService,
    private readonly cells: ExperimentCellExecutionService,
  ) {}

  /** Folds the workflow's raw server events into the target result + evaluator events. */
  private async foldFlowEvents({
    events,
    cell,
    projectId,
    traceId,
    evaluatorNodeNames,
  }: {
    events: StudioServerEvent[];
    cell: ExecutionCell;
    projectId: string;
    traceId: string;
    evaluatorNodeNames: Map<string, string | undefined>;
  }): Promise<FoldedFlowState> {
    const state: FoldedFlowState = {
      targetOutput: undefined,
      targetOutputRecord: undefined,
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
        const ex = event.payload.execution_state;
        if (ex?.result !== undefined) {
          state.targetOutput = extractTargetOutput(ex.result);
          state.targetOutputRecord = ex.result;
        }
        if (ex?.trace_id) state.finalTraceId = ex.trace_id;
        if (ex?.timestamps?.started_at !== undefined && ex?.timestamps?.finished_at !== undefined) {
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
        continue;
      }

      if (event.type !== "component_state_change") continue;
      const { component_id, execution_state } = event.payload;
      if (!execution_state) continue;

      if (typeof execution_state.cost === "number" && execution_state.cost > 0) {
        state.totalCost += execution_state.cost;
        state.sawCost = true;
      } else {
        // LLM nodes report tokens but no cost (the engine has no price table),
        // so price them at the canonical model rate, same as executeCell.
        const cost = await this.cells.tryPriceMetrics({
          projectId,
          metrics: execution_state.metrics,
        });
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
              trace_id: execution_state.trace_id ?? state.finalTraceId,
            },
          ),
        );
      }
    }

    return state;
  }

  /** The `target_result` event for the workflow's End node, first so storage links evaluator results to it. */
  private targetResultEvent({
    cell,
    state,
  }: {
    cell: ExecutionCell;
    state: FoldedFlowState;
  }): EvaluationV3Event {
    return {
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
      error: state.targetFailed ? (state.targetFailure?.error ?? UNNAMED_FAILURE) : undefined,
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
    };
  }

  /** Evaluators attached to the column, not part of the workflow, graded through S4's loop. */
  private gradeAttachedEvaluators({
    cell,
    projectId,
    datasetColumns,
    loadedEvaluators,
    resultMapperConfig,
    isAborted,
    state,
  }: {
    cell: ExecutionCell;
    projectId: string;
    datasetColumns: Array<{ id: string; name: string; type: string }>;
    loadedEvaluators?: LoadedEvaluators;
    resultMapperConfig?: ResultMapperConfig;
    isAborted?: () => Promise<boolean>;
    state: FoldedFlowState;
  }): AsyncGenerator<EvaluationV3Event> {
    const { workflow, evaluatorNodeIds } = buildEvaluatorCellWorkflow({
      projectId,
      cell,
      datasetColumns,
      loadedEvaluators,
    });
    return this.cells.runCellEvaluators({
      cell,
      projectId,
      workflow,
      evaluatorNodeIds,
      targetOutput: state.targetOutputRecord!,
      traceId: state.finalTraceId,
      targetNodes: new Set([cell.targetId]),
      config: resultMapperConfig ?? {},
      isAborted,
    });
  }

  async *executeWorkflowCell({
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
    workflowDsl: StudioWorkflow;
    datasetColumns?: Array<{ id: string; name: string; type: string }>;
    loadedEvaluators?: LoadedEvaluators;
    resultMapperConfig?: ResultMapperConfig;
    isAborted?: () => Promise<boolean>;
    /** The run's agent cache credential, when it minted one. */
    sandboxApiKey?: string;
  }): AsyncGenerator<EvaluationV3Event> {
    yield { type: "cell_started", rowIndex: cell.rowIndex, targetId: cell.targetId };

    try {
      const traceId = cell.traceId ?? generateOtelTraceId();
      const inputs = ExperimentEvaluatorInputService.create({}).buildTargetInputs({ cell });

      // The workflow's own evaluator nodes carry the scores we surface per row.
      // Keep each node's display name so results show it (e.g. "Exact Match")
      // instead of the raw node id; these nodes have no DB evaluator to resolve.
      const evaluatorNodeNames = new Map(
        workflowDsl.nodes.filter((n) => n.type === "evaluator").map((n) => [n.id, n.data?.name]),
      );

      const rawEvent = {
        type: "execute_flow" as const,
        payload: {
          trace_id: traceId,
          workflow: { ...workflowDsl, state: { execution: { status: "idle" as const } } },
          inputs: [inputs],
          manual_execution_mode: false,
          do_not_trace: false,
          run_evaluations: true,
          origin: "evaluation",
        },
      };

      const enrichedEvent = sandboxKey.withSandboxApiKey(
        await this.workflows.prepareStudioEvent({ event: rawEvent, projectId }),
        sandboxApiKey,
      );

      const events: StudioServerEvent[] = [];
      await this.ports.studio.postEvent({
        projectId,
        event: enrichedEvent,
        isAborted,
        onEvent: (serverEvent) => {
          events.push(serverEvent);
        },
      });

      const state = await this.foldFlowEvents({
        events,
        cell,
        projectId,
        traceId,
        evaluatorNodeNames,
      });

      yield this.targetResultEvent({ cell, state });

      for (const evaluatorEvent of state.evaluatorEvents) {
        yield evaluatorEvent;
      }

      // Evaluators attached to this column, not part of the workflow, so
      // they did not run with it. Only reached when the workflow produced a
      // result — grading an absent answer would score the absence itself.
      if (!state.targetFailed && state.targetOutputRecord && cell.evaluatorConfigs.length > 0) {
        yield* this.gradeAttachedEvaluators({
          cell,
          projectId,
          datasetColumns,
          loadedEvaluators,
          resultMapperConfig,
          isAborted,
          state,
        });
      }
    } catch (error) {
      logger.error(
        { error, rowIndex: cell.rowIndex, targetId: cell.targetId },
        "Workflow cell execution failed",
      );
      yield mapThrownErrorEvent({ error, rowIndex: cell.rowIndex, targetId: cell.targetId });
    }
  }
}
