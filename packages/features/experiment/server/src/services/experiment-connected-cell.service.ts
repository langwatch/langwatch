/**
 * Runs one cell whose target is a connected agent (ADR-128). The agent
 * runs in the customer's own process, so the engine has no node for it:
 * the row is one turn through the relay dispatcher, sent from here and
 * answered in place. Every instance being full is a queue rather than a
 * failure, so the turn is retried while the agent says it is busy, inside
 * a bounded budget and with jitter. The answer is then graded through
 * S4's loop, so a connected column scores, costs and traces like every
 * other column.
 */

import {
  BUSY_RETRY_AFTER_MS,
  DEFAULT_CALL_TIMEOUT_MS,
  MAX_CALL_TIMEOUT_MS,
  AgentBusyError,
  type CallOutcome,
  type ConnectedAgentConfig,
  type DispatchAgent,
  type DispatchCall,
} from "@langwatch/agent-contract";
import type { Agent as TypedAgent } from "@langwatch/agent-contract";
import {
  CONNECTED_OUTPUT_FIELD,
  connectedParameterDefinitions,
  type EvaluationV3Event,
  type ExecutionCell,
} from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";
import { generateOtelSpanId, generateOtelTraceId } from "@langwatch/trace-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";
import { buildEvaluatorCellWorkflow } from "../processes/experiment-cell-workflow.process";
import {
  buildConnectedCall,
  CONNECTED_BUSY_RETRY_BUDGET_MS,
  CONNECTED_REQUEST_SLACK_MS,
  connectedCallFailure,
  connectedOutputText,
} from "../processes/experiment-connected-target.process";
import type { ResultMapperConfig } from "../processes/experiment-result-mapping.process";
import { ExperimentEvaluatorInputService } from "./experiment-evaluator-input.service";
import type { ExperimentCellExecutionService } from "./experiment-cell-execution.service";
import type { ExperimentRunPorts } from "./experiment-run-orchestrator.service";
import type { LoadedEvaluators } from "./experiment-execution-data.service";

const logger = createLogger("langwatch:experiment:run-orchestrator");

/** One turn to a connected agent, as the cell executor asks for it. */
export type ConnectedDispatch = (params: {
  projectId: string;
  agent: DispatchAgent;
  call: DispatchCall;
  signal: AbortSignal;
}) => Promise<CallOutcome>;

/** What one connected agent cell needs to run, once the run's own world (ports, dispatcher, clock) is injected at `create`. */
export type ConnectedCellExecutionInput = {
  cell: ExecutionCell;
  projectId: string;
  agent: TypedAgent;
  datasetColumns?: Array<{ id: string; name: string; type: string }>;
  loadedEvaluators?: LoadedEvaluators;
  resultMapperConfig?: ResultMapperConfig;
  isAborted?: () => Promise<boolean>;
};

export class ExperimentConnectedCellService {
  /**
   * `workflows` is accepted (not stored) to give this the same `create` shape
   * as every other cell executor — `cells` already closes over it. `ports` is
   * read for the connected dispatcher the turn goes through.
   */
  static create({
    ports,
    cells,
    dispatch,
    sleep,
    now,
  }: {
    ports: ExperimentRunPorts;
    workflows: WorkflowService;
    cells: ExperimentCellExecutionService;
    dispatch?: ConnectedDispatch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  }): ExperimentConnectedCellService {
    return new ExperimentConnectedCellService(
      cells,
      dispatch ?? ((params) => ports.connectedDispatch.dispatch(params)),
      sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))),
      now ?? (() => Date.now()),
    );
  }

  private constructor(
    private readonly cells: ExperimentCellExecutionService,
    private readonly dispatch: ConnectedDispatch,
    private readonly sleep: (ms: number) => Promise<void>,
    private readonly now: () => number,
  ) {}

  /**
   * The agent as the dispatcher reads it, budget-capped the same way the
   * relay route caps it — a column may not ask for a longer call.
   */
  private dispatchAgentOf(agent: TypedAgent): DispatchAgent {
    const config = agent.config as ConnectedAgentConfig;

    return {
      id: agent.id,
      name: agent.name,
      environment: agent.environment ?? null,
      timeoutMs: Math.min(config.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, MAX_CALL_TIMEOUT_MS),
      // A workbench row is a conversation of one turn, so there is nothing to
      // pin: every row picks whichever instance is free.
      isSticky: false,
    };
  }

  /** The one turn a row sends: the mapped row as a single user message, in its own conversation and trace. */
  private connectedTurnParams({
    cell,
    projectId,
    agent,
    dispatchAgent,
    traceId,
  }: {
    cell: ExecutionCell;
    projectId: string;
    agent: TypedAgent;
    dispatchAgent: DispatchAgent;
    traceId: string;
  }): Omit<Parameters<ConnectedDispatch>[0], "signal"> {
    const { messages, params } = buildConnectedCall({
      inputs: ExperimentEvaluatorInputService.create({}).buildTargetInputs({ cell }),
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
  }

  /**
   * What the cell shows when the turn did not answer. A named failure keeps
   * its code, so the cell renders that code's copy instead of a generic
   * unknown error.
   */
  private connectedFailureEvent({
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
  }): EvaluationV3Event {
    logger.info(
      { error, projectId, agentId, rowIndex: cell.rowIndex, targetId: cell.targetId },
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
  }

  /** How long a busy agent asked to be left alone, or nothing if it is not busy. */
  private busyRetryAfterMs(error: unknown): number | undefined {
    if (!(error instanceof AgentBusyError)) {
      return undefined;
    }

    const declared = error.meta?.retryAfterMs;

    return typeof declared === "number" && declared > 0 ? declared : BUSY_RETRY_AFTER_MS;
  }

  /**
   * How long to wait before the next attempt, or nothing when the turn must
   * fail now: the agent refused for a reason other than busy, the retry
   * budget is spent, or the run was stopped (which waits for nothing).
   */
  private async busyWaitMs({
    error,
    budgetEndsAt,
    isAborted,
  }: {
    error: unknown;
    budgetEndsAt: number;
    isAborted?: () => Promise<boolean>;
  }): Promise<number | undefined> {
    const retryAfterMs = this.busyRetryAfterMs(error);
    if (retryAfterMs === undefined || this.now() >= budgetEndsAt) {
      return undefined;
    }

    if (isAborted && (await isAborted())) {
      return undefined;
    }

    // Jitter spreads the retries of the rows that hit a full agent at once.
    const jittered = retryAfterMs + Math.floor(Math.random() * retryAfterMs);

    return Math.max(0, Math.min(jittered, budgetEndsAt - this.now()));
  }

  /**
   * One turn, waiting out a busy agent. Every instance being full is a
   * queue, not a failure — the row waits, the same way a simulation turn
   * does, bounded so a permanently full agent still fails the row.
   */
  private async dispatchWithBusyRetry({
    params,
    isAborted,
    budgetEndsAt,
    callTimeoutMs,
  }: {
    params: Omit<Parameters<ConnectedDispatch>[0], "signal">;
    isAborted?: () => Promise<boolean>;
    budgetEndsAt: number;
    callTimeoutMs: number;
  }): Promise<CallOutcome> {
    for (;;) {
      try {
        // Every attempt gets its own deadline, not one shared signal — a
        // shared signal would carry the earlier attempts' spent time and
        // abort a later attempt the moment it starts.
        return await this.dispatch({ ...params, signal: AbortSignal.timeout(callTimeoutMs) });
      } catch (error) {
        const waitMs = await this.busyWaitMs({ error, budgetEndsAt, isAborted });
        if (waitMs === undefined) {
          throw error;
        }

        await this.sleep(waitMs);
      }
    }
  }

  /**
   * The one turn the row sends, retried while the agent is busy. The
   * refusal comes back rather than being thrown, so the caller renders it
   * as the cell's own failure instead of ending the run.
   */
  private async connectedTurn({
    input,
    traceId,
    startedAt,
  }: {
    input: ConnectedCellExecutionInput;
    traceId: string;
    startedAt: number;
  }): Promise<{ ok: true; outcome: CallOutcome } | { ok: false; error: unknown }> {
    const { cell, projectId, agent, isAborted } = input;
    const dispatchAgent = this.dispatchAgentOf(agent);
    try {
      const outcome = await this.dispatchWithBusyRetry({
        isAborted,
        budgetEndsAt: startedAt + CONNECTED_BUSY_RETRY_BUDGET_MS,
        callTimeoutMs: dispatchAgent.timeoutMs + CONNECTED_REQUEST_SLACK_MS,
        params: this.connectedTurnParams({ cell, projectId, agent, dispatchAgent, traceId }),
      });

      return { ok: true, outcome };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * The evaluators of the column, over the answer the turn gave — run
   * through the same path a workflow target uses, so a connected column
   * scores, costs and traces like every other column.
   */
  private async *gradeConnectedAnswer({
    input,
    output,
    traceId,
  }: {
    input: ConnectedCellExecutionInput;
    output: string;
    traceId: string;
  }): AsyncGenerator<EvaluationV3Event> {
    const {
      cell,
      projectId,
      datasetColumns = [],
      loadedEvaluators,
      resultMapperConfig,
      isAborted,
    } = input;
    if (cell.evaluatorConfigs.length === 0) {
      return;
    }

    const { workflow, evaluatorNodeIds } = buildEvaluatorCellWorkflow({
      projectId,
      cell,
      datasetColumns,
      loadedEvaluators,
    });
    yield* this.cells.runCellEvaluators({
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

  async *executeConnectedCell(
    input: ConnectedCellExecutionInput,
  ): AsyncGenerator<EvaluationV3Event> {
    const { cell, projectId, agent } = input;
    const traceId = cell.traceId ?? generateOtelTraceId();
    const startedAt = this.now();

    yield { type: "cell_started", rowIndex: cell.rowIndex, targetId: cell.targetId };

    const turn = await this.connectedTurn({ input, traceId, startedAt });

    if (!turn.ok) {
      yield this.connectedFailureEvent({
        cell,
        projectId,
        agentId: agent.id,
        error: turn.error,
        traceId,
        duration: this.now() - startedAt,
      });

      return;
    }

    const output = connectedOutputText(turn.outcome.output);

    yield {
      type: "target_result",
      rowIndex: cell.rowIndex,
      targetId: cell.targetId,
      output,
      // The whole cell, not only the call that answered: a row that waited out
      // a busy agent took that time too, and a run comparison reads it.
      duration: this.now() - startedAt,
      traceId,
    };

    yield* this.gradeConnectedAnswer({ input, output, traceId });
  }
}
