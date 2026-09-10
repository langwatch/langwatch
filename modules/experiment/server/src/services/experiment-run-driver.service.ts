/**
 * Drives one run from end to end: what it fixes before the first cell, which executor each cell
 * goes through, the second phase its comparisons need, and the events the caller sees. The planning
 * and cell primitives stay on the orchestrator; this is the order they happen in.
 */

import { createLogger } from "@langwatch/observability";
import type {
  EvaluationV3Event,
  ExecutionCell,
  ExecutionSummary,
} from "@langwatch/experiment-contract";
import { generateHumanReadableId } from "@langwatch/experiment-contract";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import { buildStripScoreEvaluatorIds } from "../processes/experiment-evaluator-score-filter.process.ts";
import { createEventStream } from "../processes/experiment-run-event-stream.process.ts";
import type { ResultMapperConfig } from "../processes/experiment-result-mapping.process.ts";
import type { OrchestratorInput } from "../rules/experiment-run-input.rules.ts";
import { ExperimentCarriedBoardService } from "./experiment-carried-board.service.ts";
import { ExperimentResultDispatchService } from "./experiment-result-dispatch.service.ts";
import { ExperimentRunLoopService, type PhaseTwoPlan } from "./experiment-run-loop.service.ts";
import { ExperimentRunSandboxKeyService } from "./experiment-run-sandbox-key.service.ts";
import { ExperimentRunStorageService } from "./experiment-run-storage.service.ts";
import { ExperimentRunOrchestratorService } from "./experiment-run-orchestrator.service.ts";
import { ExperimentTargetDataService } from "./experiment-target-data.service.ts";
import { nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:experiment:run-driver");

const resultDispatches = ExperimentResultDispatchService.create();
const sandboxKey = ExperimentRunSandboxKeyService.create();

/** What a run fixes before its first cell, and every collaborator its phases read through. */
interface PreparedRun {
  runId: string;
  cells: ExecutionCell[];
  storage: ExperimentRunStorageService;
  resultMapperConfig: ResultMapperConfig;
  sandboxApiKey?: string;
}

export class ExperimentRunDriverService {
  private constructor() {}

  static create(): ExperimentRunDriverService {
    return new ExperimentRunDriverService();
  }

  /** Main orchestrator: executes all cells and yields SSE events, with parallel execution under a semaphore. */
  static async *runOrchestrator(input: OrchestratorInput): AsyncGenerator<EvaluationV3Event> {
    const { projectId, experimentId, ports, loadedAgents, actor } = input;

    // A personal development agent runs on one person's own machine, so only
    // that person may send it a turn. Refused before any cell exists, the way a
    // simulation refuses it when the run is scheduled.
    await ports.connectedAgentOwnership.assertRunnable({
      agents: [...loadedAgents.values()],
      actor,
    });

    const run = await ExperimentRunDriverService.prepareRun(input);
    const { runId, storage } = run;
    const { pushEvent, signalComplete, waitForEvent } = createEventStream();
    const recordEvent = (event: EvaluationV3Event) =>
      storage.record({
        event,
        projectId,
        runId,
        experimentId,
        state: input.state,
        loadedEvaluators: input.loadedEvaluators,
        datasetRows: input.datasetRows,
      });

    const loop = ExperimentRunLoopService.create({
      runId,
      cells: run.cells,
      concurrency: input.concurrency ?? input.defaultConcurrency,
      isAborted: () => ports.abort.isAborted(runId),
      cellEvents: (cell) => ExperimentRunDriverService.cellEvents({ cell, run, input }),
      pushEvent,
      recordEvent,
      planPhaseTwo: () => ExperimentRunDriverService.planPhaseTwo({ run, input }),
    });

    yield { type: "execution_started", runId, total: loop.totalCells };

    const startTime = nowInstant().epochMilliseconds;
    logger.info(
      { runId, totalCells: loop.totalCells, concurrency: input.concurrency, experimentId },
      "Starting evaluation execution",
    );

    const processingPromise = loop.run().finally(() => signalComplete());

    yield* ExperimentRunDriverService.streamRun({
      loop,
      waitForEvent,
      processingPromise,
      input,
      run,
    });
    yield* ExperimentRunDriverService.finishRun({ loop, run, startTime });
  }

  /**
   * Everything a run fixes before its first cell: its id, its cells, the storage that mirrors them,
   * the target metadata a result is attributed to, and the one sandbox credential a run that
   * executes Python needs. The run is marked running here, so every dispatch path has it.
   */
  private static async prepareRun(input: OrchestratorInput): Promise<PreparedRun> {
    const { projectId, scope, state, datasetRows, ports } = input;
    const runId = input.runId ?? generateHumanReadableId();
    const cells = ExperimentRunOrchestratorService.generateCells(state, datasetRows, scope, {
      seedTargetOutputs: input.seedTargetOutputs,
    });

    logger.info(
      { runId, totalCells: cells.length, scopeType: scope.type, targetCount: state.targets.length },
      "Starting orchestrator",
    );

    // Set running flag + record the owner, which is what abort authorizes
    // against. Set here rather than by the caller, so every dispatch path has it
    // from the first frame.
    await ports.abort.setRunning({ runId, projectId });

    const storage = ExperimentRunStorageService.create({
      commands: ports.experiments,
      evaluationReporting: ports.evaluationReporting,
      dispatches: resultDispatches,
      cells,
      seedTargetOutputs: input.seedTargetOutputs,
    });
    const prepared: PreparedRun = {
      runId,
      cells,
      storage,
      resultMapperConfig: { stripScoreEvaluatorIds: buildStripScoreEvaluatorIds(state.evaluators) },
      // One agent cache credential for this whole run, minted only when a
      // target actually runs Python. Undefined when nothing does, or when the
      // mint failed, and the engine then injects nothing.
      sandboxApiKey: await sandboxKey.findRunSandboxApiKey({
        sandboxCredentials: ports.sandboxCredentials,
        projectId,
        loadedAgents: input.loadedAgents,
        loadedWorkflows: input.loadedWorkflows,
      }),
    };

    await ExperimentRunDriverService.recordRunStart({ input, run: prepared });

    return prepared;
  }

  /** The run's opening rows in storage: the run itself, then the board it carries rather than runs. */
  private static async recordRunStart({
    input,
    run,
  }: {
    input: OrchestratorInput;
    run: PreparedRun;
  }): Promise<void> {
    const { projectId, experimentId, ports } = input;
    if (!experimentId) {
      return;
    }

    try {
      await run.storage.startRun({
        projectId,
        runId: run.runId,
        experimentId,
        workflowVersionId: input.workflowVersionId,
        totalCells: run.cells.length,
        targets: ExperimentRunOrchestratorService.buildTargetMetadata({
          targets: input.state.targets,
          loadedPrompts: input.loadedPrompts,
          loadedAgents: input.loadedAgents,
          loadedEvaluators: input.loadedEvaluators,
          loadedWorkflows: input.loadedWorkflows,
        }),
      });
    } catch (err) {
      await ports.abort.clearRunning(run.runId);

      throw err;
    }

    await ExperimentCarriedBoardService.create({
      commands: ports.experiments,
      dispatches: resultDispatches,
    }).recordCarriedOverBoard({
      projectId,
      runId: run.runId,
      experimentId,
      cells: input.carriedOverCells ?? [],
      datasetRows: input.datasetRows,
      state: input.state,
      loadedEvaluators: input.loadedEvaluators,
    });
  }

  /**
   * The executor one cell runs under: a connected agent through the relay, a workflow target (or an
   * agent wrapping a Studio workflow) through execute_flow once per row, and everything else as a
   * single component.
   */
  private static cellEvents({
    cell,
    run,
    input,
  }: {
    cell: ExecutionCell;
    run: PreparedRun;
    input: OrchestratorInput;
  }): AsyncGenerator<EvaluationV3Event> {
    const { projectId, ports, workflows, datasetColumns, loadedEvaluators } = input;
    const loadedData = {
      ...ExperimentTargetDataService.loadedDataForTarget(
        cell.targetConfig,
        input.loadedPrompts,
        input.loadedAgents,
        input.loadedWorkflows,
      ),
      evaluators: loadedEvaluators,
      sandboxApiKey: run.sandboxApiKey,
    };
    const isAborted = () => ports.abort.isAborted(run.runId);
    const shared = {
      cell,
      projectId,
      datasetColumns,
      loadedEvaluators,
      resultMapperConfig: run.resultMapperConfig,
      isAborted,
      ports,
      workflows,
    };

    // A connected agent has no node in the engine: it runs in the customer's
    // own process and is reached through the relay.
    if (cell.targetConfig.type === "agent" && loadedData.agent?.type === "connected") {
      return ExperimentRunOrchestratorService.executeConnectedCell({
        ...shared,
        agent: loadedData.agent,
      });
    }

    const runsAsWorkflow =
      (cell.targetConfig.type === "workflow" ||
        (cell.targetConfig.type === "agent" && loadedData.agent?.type === "workflow")) &&
      !!loadedData.workflow;
    if (runsAsWorkflow) {
      return ExperimentRunOrchestratorService.executeWorkflowCell({
        ...shared,
        workflowDsl: loadedData.workflow!.dsl,
        sandboxApiKey: run.sandboxApiKey,
      });
    }

    return ExperimentRunOrchestratorService.executeCell(
      cell,
      projectId,
      ports,
      datasetColumns,
      loadedData,
      workflows,
      run.resultMapperConfig,
      isAborted,
    );
  }

  /**
   * Phase 2 planned once phase 1 has finished, so every comparison has its variants' outputs. An
   * `evaluator` scope seeds nothing, so it has no comparison work even though every row is in it.
   */
  private static async planPhaseTwo({
    run,
    input,
  }: {
    run: PreparedRun;
    input: OrchestratorInput;
  }): Promise<PhaseTwoPlan | null> {
    const { scope, state, datasetRows } = input;
    if (scope.type === "evaluator" || scope.type === "evaluator-all-rows") {
      return null;
    }

    const scopedRowIndices = ExperimentRunOrchestratorService.resolveScopedRowIndices({
      scope,
      rowCount: datasetRows.length,
    });
    const { cells, skipReasons } = ExperimentRunOrchestratorService.generateComparisonCells({
      state,
      datasetRows,
      completedTargetOutputs: run.storage.outputs,
      completedTargetEvaluatorScores: run.storage.evaluatorScores,
      loadedPrompts: input.loadedPrompts,
      loadedEvaluators: input.loadedEvaluators,
      // Only the rows this run owns. Without this, re-running row 1 alone
      // wrote "waiting on …" over every other row's verdict.
      scopedRowIndices,
    });

    return {
      cells,
      // One synthetic evaluator_result error per skipped row, so the comparison
      // column does not sit at "No verdict yet" forever.
      skipEvents: skipReasons.map((reason) => {
        const { detail, errorType } =
          ExperimentRunOrchestratorService.comparisonSkipMessage(reason);

        return {
          type: "evaluator_result",
          rowIndex: reason.rowIndex,
          targetId: reason.targetId,
          evaluatorId: reason.evaluatorId,
          result: {
            status: "error",
            details: detail,
            error_type: errorType,
          } as unknown as SingleEvaluationResult,
        } satisfies EvaluationV3Event;
      }),
      backfillEvents: ExperimentRunDriverService.seededBackfillEvents({
        run,
        input,
        hasComparisons: cells.length > 0,
        rowsThisRunOwns: new Set(scopedRowIndices),
      }),
    };
  }

  /**
   * The candidate outputs a run REUSED rather than executed. Such a run stores only the judge's
   * verdict, so the results view showed nothing and no cost; re-recording them carries the seeded
   * cost and duration across so the per-target headers are not blank.
   */
  private static seededBackfillEvents({
    run,
    input,
    hasComparisons,
    rowsThisRunOwns,
  }: {
    run: PreparedRun;
    input: OrchestratorInput;
    hasComparisons: boolean;
    rowsThisRunOwns: Set<number>;
  }): EvaluationV3Event[] {
    const seeded = input.seedTargetOutputs;
    if (!hasComparisons || !seeded) {
      return [];
    }

    return Object.entries(seeded)
      .map(([key, value]) =>
        ExperimentRunOrchestratorService.findSeededTargetResultEvent(key, value, {
          storage: run.storage,
          rowsThisRunOwns,
          datasetRows: input.datasetRows,
        }),
      )
      .filter((event): event is EvaluationV3Event => event !== null);
  }

  /** Hands the caller every event as it arrives, and the stop frame when a user ended the run. */
  private static async *streamRun({
    loop,
    waitForEvent,
    processingPromise,
    input,
    run,
  }: {
    loop: ExperimentRunLoopService;
    waitForEvent: () => Promise<EvaluationV3Event | null>;
    processingPromise: Promise<void>;
    input: OrchestratorInput;
    run: PreparedRun;
  }): AsyncGenerator<EvaluationV3Event> {
    const { projectId, experimentId, ports } = input;
    try {
      while (true) {
        const event = await waitForEvent();
        if (event === null) {
          break;
        }

        yield event;
      }

      if (loop.aborted) {
        logger.info(
          { runId: run.runId, completedCells: loop.completedCells, totalCells: loop.totalCells },
          "Emitting stopped event",
        );
        yield { type: "stopped", reason: "user" };
      }

      await processingPromise;
    } finally {
      await ports.abort.clearRunning(run.runId);
      await ports.abort.clearAbort(run.runId);
      if (experimentId) {
        await run.storage.completeRun({
          projectId,
          runId: run.runId,
          experimentId,
          aborted: loop.aborted,
          finishedAt: nowInstant().epochMilliseconds,
        });
      }
    }
  }

  /** The run's last frame: the summary a completed run reports, or nothing when a user stopped it. */
  private static async *finishRun({
    loop,
    run,
    startTime,
  }: {
    loop: ExperimentRunLoopService;
    run: PreparedRun;
    startTime: number;
  }): AsyncGenerator<EvaluationV3Event> {
    const { storage, runId } = run;
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

    const finishedAt = nowInstant().epochMilliseconds;
    const duration = finishedAt - startTime;
    const counts = {
      runId,
      completedCells: loop.completedCells,
      failedCells: loop.failedCells,
      totalCells: loop.totalCells,
      duration,
    };
    if (loop.aborted) {
      logger.info(counts, "Evaluation execution stopped by user");

      return;
    }

    logger.info(
      { ...counts, totalCost: loop.totalCost },
      "Evaluation execution completed successfully",
    );
    const summary: ExecutionSummary = {
      runId,
      totalCells: loop.totalCells,
      completedCells: loop.completedCells,
      failedCells: loop.failedCells,
      duration,
      ...(storage.dispatchFailures > 0 && { chDispatchFailures: storage.dispatchFailures }),
      timestamps: { startedAt: startTime, finishedAt },
    };

    yield { type: "done", summary };
  }
}
