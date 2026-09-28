/**
 * A workbench run streamed over the run's pipeline: subscribed to its frames, started, and read
 * until it ends. Design: specs/experiment-run-execution.md section 7.
 */
import type {
  CarriedOverCell,
  EvaluationV3Event,
  EvaluationsV3State,
  ExperimentRunPlan,
} from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { RunActor } from "@langwatch/scenario-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import { nowInstant } from "@langwatch/time";

import type { ExperimentWorkbenchObserver } from "../app/experiment-workbench.members.ts";
import type {
  ExperimentRunEventStream,
  ExperimentRunStreamMessage,
} from "../channels/experiment-run-event-stream.channel.ts";
import { mapThrownErrorEvent } from "../eventing/experiment-result-mapping.process.ts";
import type { ExperimentRunStartedEventData } from "../eventing/experiment-run-events.process.ts";
import type { ExperimentRunAbortRepository } from "../repositories/experiment-run-abort.repository.ts";
import type { ExperimentRunFoldRepository } from "../repositories/experiment-run-fold.repository.ts";
import type { ExperimentRunRefusals } from "../rules/experiment-run-availability.rules.ts";
import { ExperimentCarriedBoardService } from "./experiment-carried-board.service.ts";
import type {
  ExecutionDataServices,
  LoadedExecutionData,
} from "./experiment-execution-data.service.ts";
import { ExperimentResultDispatchService } from "./experiment-result-dispatch.service.ts";
import type { ExperimentRunCommandDispatcherService } from "./experiment-run-command-dispatcher.service.ts";
import { ExperimentRunRegistrationService } from "./experiment-run-registration.service.ts";
import type { ExperimentService } from "./experiment.service.ts";

const logger = createLogger("langwatch:experiments-v3");

/** The run pipeline's senders, folds, stop signal and frames' channel, and what a start reads. */
export type WorkbenchRunPipeline = Readonly<{
  commands: Pick<
    ExperimentRunCommandDispatcherService,
    "startExperimentRun" | "completeExperimentRun" | "abortExperimentRun"
  >;
  stream: ExperimentRunEventStream;
  folds: ExperimentRunFoldRepository;
  abort: ExperimentRunAbortRepository;
  /** This deployment's public origin, for the link a polled run answers with. */
  publicBaseUrl: string | undefined;
  /** The peers a run's execution data is loaded through before it is planned. */
  services: ExecutionDataServices;
  /** Refuses a run against someone else's personal development agent before it starts. */
  ownership: Pick<SuiteApi, "assertConnectedAgentsRunnable">;
  /** Cells in flight at once when a run names no limit of its own. */
  concurrency: number;
  /** What this process refuses of a run, for want of Redis or a public address. */
  refusals: ExperimentRunRefusals;
}>;

/** What one pipeline run starts from: its start, and what is checked and carried beside it. */
export type PipelineRunStart = {
  start: ExperimentRunStartedEventData & { tenantId: string; occurredAt: number };
  /** Whom a personal development agent is checked against; nobody is refused by its rule. */
  actor: RunActor | undefined;
  data: LoadedExecutionData;
  state: EvaluationsV3State;
  carriedOverCells: CarriedOverCell[];
  /** What an unnamed failure is reported with. */
  reportContext: Readonly<Record<string, unknown>>;
  /** Recorded once a streamed run ends done or stopped; only a person's run records one. */
  ran?: Parameters<ExperimentWorkbenchObserver["recordExperimentRan"]>[0];
};

type WorkbenchPipelineRunDeps = {
  experiments: ExperimentService;
  observer: ExperimentWorkbenchObserver;
  runs: WorkbenchRunPipeline;
};

export class ExperimentWorkbenchPipelineRunService {
  private readonly experiments: ExperimentService;
  private readonly observer: ExperimentWorkbenchObserver;
  private readonly runs: WorkbenchRunPipeline;

  private constructor(deps: WorkbenchPipelineRunDeps) {
    this.experiments = deps.experiments;
    this.observer = deps.observer;
    this.runs = deps.runs;
  }

  static create(deps: WorkbenchPipelineRunDeps): ExperimentWorkbenchPipelineRunService {
    return new ExperimentWorkbenchPipelineRunService(deps);
  }

  /** The start a pipeline run sends: its plan, its cell count and its targets' metadata. */
  startOf({
    projectId,
    runId,
    experimentId,
    plan,
    state,
    data,
  }: {
    projectId: string;
    runId: string;
    experimentId: string;
    plan: ExperimentRunPlan;
    state: EvaluationsV3State;
    data: LoadedExecutionData;
  }): PipelineRunStart["start"] {
    return {
      tenantId: projectId,
      occurredAt: nowInstant().epochMilliseconds,
      runId,
      experimentId,
      workflowVersionId: null,
      total: plan.cells.length,
      targets: ExperimentResultDispatchService.create().buildTargetMetadata({
        targets: state.targets,
        loadedPrompts: data.loadedPrompts,
        loadedAgents: data.loadedAgents,
        loadedEvaluators: data.loadedEvaluators,
        loadedWorkflows: data.loadedWorkflows,
      }),
      plan,
    };
  }

  /**
   * A streamed run: subscribed before the start is sent, so no frame is missed, and ended on done,
   * stopped or the run's own error. A dropped stream is not resumed; the client polls
   * `GET /runs/:runId` (spec section 7).
   */
  async *streamRun(run: PipelineRunStart): AsyncGenerator<EvaluationV3Event> {
    try {
      // A personal development agent runs on one person's machine; only they may send it a turn.
      await this.runs.ownership.assertConnectedAgentsRunnable({
        agents: [...run.data.loadedAgents.values()],
        actor: run.actor,
      });
      for await (const frame of this.#frames(run)) {
        yield frame;
        if (run.ran && (frame.type === "done" || frame.type === "stopped")) {
          this.observer.recordExperimentRan(run.ran);
        }
      }
    } catch (error) {
      logger.error({ error, ...run.reportContext }, "Pipeline run error");
      this.observer.reportError(error, run.reportContext);
      yield mapThrownErrorEvent({ error });
    }
  }

  /**
   * A polled run: started, left to the worker, and answered once its poller can read it, as main
   * registered it first. A refusal is the run's failure, whose code the poller reads (wire note 6).
   */
  async startRun(run: PipelineRunStart): Promise<void> {
    const { runId, experimentId } = run.start;
    try {
      await this.runs.ownership.assertConnectedAgentsRunnable({
        agents: [...run.data.loadedAgents.values()],
        actor: run.actor,
      });
    } catch (error) {
      await this.#failBeforeStart({ run, error });
      await this.#registration().awaitRegistered({ runId, experimentId });
      return;
    }

    await this.runs.commands.startExperimentRun(run.start);
    await this.#carryBoard({ run });
    await this.#registration().awaitRegistered({ runId, experimentId });
  }

  /** The run's frames in `seq` order, a redelivered one dropped, until the run ends. */
  async *#frames(run: PipelineRunStart): AsyncGenerator<EvaluationV3Event> {
    const { runId } = run.start;
    const queued: ExperimentRunStreamMessage[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = await this.runs.stream.subscribe({
      runId,
      onMessage: (message) => {
        queued.push(message);
        wake?.();
      },
    });
    try {
      await this.runs.commands.startExperimentRun(run.start);
      await this.#carryBoard({ run });

      let seen = 0;
      let ended = false;
      while (!ended) {
        const next = queued.shift();
        if (next === undefined) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
          continue;
        }
        // Never folded, so it repeats the last seq; only folded frames are deduplicated.
        if (next.frame.type === "cell_started") {
          yield next.frame;
          continue;
        }
        if (next.seq <= seen) continue;

        seen = next.seq;
        yield next.frame;
        ended = endsRun(next.frame);
      }
    } finally {
      await unsubscribe();
    }
  }

  /** The run completed failed before it started, with the refusal when it is handled. */
  async #failBeforeStart({ run, error }: { run: PipelineRunStart; error: unknown }): Promise<void> {
    const { runId, experimentId, tenantId } = run.start;
    logger.error({ error, runId, ...run.reportContext }, "Execution error");
    if (!HandledError.isHandled(error)) this.observer.reportError(error, run.reportContext);

    await this.runs.commands.completeExperimentRun({
      tenantId,
      occurredAt: nowInstant().epochMilliseconds,
      runId,
      experimentId,
      outcome: "failed",
      total: run.start.total,
      ...(HandledError.isHandled(error) ? { error: error.serialize() } : {}),
    });
  }

  #registration(): ExperimentRunRegistrationService {
    return ExperimentRunRegistrationService.create({ folds: this.runs.folds });
  }

  /** The board cells the page carried into the run, recorded as the run's and never streamed. */
  async #carryBoard({ run }: { run: PipelineRunStart }): Promise<void> {
    if (run.start.experimentId === "") return;

    await ExperimentCarriedBoardService.create({
      commands: this.experiments,
      dispatches: ExperimentResultDispatchService.create(),
    }).recordCarriedOverBoard({
      projectId: run.start.tenantId,
      runId: run.start.runId,
      experimentId: run.start.experimentId,
      cells: run.carriedOverCells,
      datasetRows: run.data.datasetRows,
      state: run.state,
      loadedEvaluators: run.data.loadedEvaluators,
    });
  }
}

/** A run ends on done, stopped, or an error frame naming no cell, which only the run sends. */
function endsRun(frame: EvaluationV3Event): boolean {
  if (frame.type === "done" || frame.type === "stopped") return true;

  return frame.type === "error" && frame.rowIndex === undefined && frame.targetId === undefined;
}
