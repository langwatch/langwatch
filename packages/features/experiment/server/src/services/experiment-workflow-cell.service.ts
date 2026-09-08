/**
 * Runs one cell whose target is a whole committed Studio workflow. The End node's result becomes
 * the target output, each of the workflow's own evaluator nodes becomes a result under its display
 * name, and node costs are summed. Column evaluators are graded afterwards, if a result came back.
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
import { buildEvaluatorCellWorkflow } from "../processes/experiment-cell-workflow.process.ts";
import {
  extractTargetOutput,
  mapThrownErrorEvent,
  mapWorkflowEvaluatorResult,
  type ResultMapperConfig,
} from "../processes/experiment-result-mapping.process.ts";
import { ExperimentEvaluatorInputService } from "./experiment-evaluator-input.service.ts";
import type { ExperimentCellExecutionService } from "./experiment-cell-execution.service.ts";
import type { ExperimentRunPorts } from "../rules/experiment-run-input.rules.ts";
import { ExperimentRunSandboxKeyService } from "./experiment-run-sandbox-key.service.ts";
import type { LoadedEvaluators } from "./experiment-execution-data.service.ts";

const logger = createLogger("langwatch:experiment:run-orchestrator");
const sandboxKey = ExperimentRunSandboxKeyService.create();

/** The workflow run's own state, as the engine reports it on an execution-state event. */
type StudioExecutionState = Extract<
  StudioServerEvent,
  { type: "execution_state_change" }
>["payload"]["execution_state"];

/** One node's state, as the engine reports it on a component-state event. */
type StudioComponentExecutionState = NonNullable<
  Extract<StudioServerEvent, { type: "component_state_change" }>["payload"]["execution_state"]
>;

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
        ExperimentWorkflowCellService.foldExecutionState({
          state,
          execution: event.payload.execution_state,
        });
        continue;
      }

      if (event.type === "component_state_change" && event.payload.execution_state) {
        await this.foldComponentState({
          state,
          cell,
          projectId,
          evaluatorNodeNames,
          componentId: event.payload.component_id,
          execution: event.payload.execution_state,
        });
      }
    }

    return state;
  }

  /** The workflow's own run: its result, its trace, how long it took, and whether it failed. */
  private static foldExecutionState({
    state,
    execution,
  }: {
    state: FoldedFlowState;
    execution: StudioExecutionState | undefined;
  }): void {
    if (execution?.result !== undefined) {
      state.targetOutput = extractTargetOutput(execution.result);
      state.targetOutputRecord = execution.result;
    }

    if (execution?.trace_id) {
      state.finalTraceId = execution.trace_id;
    }

    const started = execution?.timestamps?.started_at;
    const finished = execution?.timestamps?.finished_at;
    if (started !== undefined && finished !== undefined) {
      state.durationMs = finished - started;
    }

    if (execution?.status === "error") {
      state.targetFailed = true;
      state.targetFailure = {
        error: execution.error,
        errorType: execution.error_type,
        upstreamStatus: execution.upstream_status,
      };
    }
  }

  /**
   * One node's run: its cost, and its verdict when the node is one of the workflow's evaluators.
   * LLM nodes report tokens but no cost, the engine having no price table, so they are priced at
   * the canonical model rate exactly as a plain cell is.
   */
  private async foldComponentState({
    state,
    cell,
    projectId,
    evaluatorNodeNames,
    componentId,
    execution,
  }: {
    state: FoldedFlowState;
    cell: ExecutionCell;
    projectId: string;
    evaluatorNodeNames: Map<string, string | undefined>;
    componentId: string;
    execution: StudioComponentExecutionState;
  }): Promise<void> {
    if (typeof execution.cost === "number" && execution.cost > 0) {
      state.totalCost += execution.cost;
      state.sawCost = true;
    } else {
      const cost = await this.cells.tryPriceMetrics({ projectId, metrics: execution.metrics });
      if (cost != null) {
        state.totalCost += cost;
        state.sawCost = true;
      }
    }

    const graded = execution.status === "success" || execution.status === "error";
    if (!evaluatorNodeNames.has(componentId) || !graded) {
      return;
    }

    state.evaluatorEvents.push(
      mapWorkflowEvaluatorResult(
        cell.rowIndex,
        cell.targetId,
        componentId,
        evaluatorNodeNames.get(componentId),
        {
          status: execution.status,
          outputs: execution.outputs,
          cost: execution.cost,
          error: execution.error,
          // The coded half of the failure: without it the evaluator cell renders the engine's raw
          // message verbatim.
          nodeErrorCode: execution.error_type,
          upstream_status: execution.upstream_status,
          trace_id: execution.trace_id ?? state.finalTraceId,
        },
      ),
    );
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
      const inputs = await this.cells.inlineAttachments({
        projectId,
        cell,
        datasetColumns,
        inputs: ExperimentEvaluatorInputService.create({}).buildTargetInputs({ cell }),
      });

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
