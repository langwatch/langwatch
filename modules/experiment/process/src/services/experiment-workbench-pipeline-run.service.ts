/**
 * A workbench run streamed over the run's pipeline: subscribed to its frames, started, and read
 * until it ends. Design: specs/experiment-run-execution.md section 7.
 */
import type {
  EvaluationV3Event,
  EvaluationsV3State,
  executionRequestSchema,
} from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";
import type { z } from "zod";

import type { ExperimentWorkbenchObserver } from "../app/experiment-workbench.members.ts";
import type {
  ExperimentRunEventStream,
  ExperimentRunStreamMessage,
} from "../channels/experiment-run-event-stream.channel.ts";
import { mapThrownErrorEvent } from "../eventing/experiment-result-mapping.process.ts";
import type { ExperimentRunStartedEventData } from "../eventing/experiment-run-events.process.ts";
import type { ExperimentRunCollaborators } from "../rules/experiment-run-input.rules.ts";
import { ExperimentCarriedBoardService } from "./experiment-carried-board.service.ts";
import type { LoadedExecutionData } from "./experiment-execution-data.service.ts";
import { ExperimentResultDispatchService } from "./experiment-result-dispatch.service.ts";
import type { ExperimentRunCommandDispatcherService } from "./experiment-run-command-dispatcher.service.ts";
import type { ExperimentService } from "./experiment.service.ts";

const logger = createLogger("langwatch:experiments-v3");

/** The run pipeline's senders, and the channel a run's frames come back on. */
export type WorkbenchRunPipeline = Readonly<{
  commands: Pick<ExperimentRunCommandDispatcherService, "startExperimentRun">;
  stream: ExperimentRunEventStream;
}>;

/** What one pipeline run streams from: its start, and what is checked and carried beside it. */
export type PipelineRunStart = {
  start: ExperimentRunStartedEventData & { tenantId: string; occurredAt: number };
  ownership: ExperimentRunCollaborators["connectedAgentOwnership"];
  data: LoadedExecutionData;
  state: EvaluationsV3State;
  input: z.infer<typeof executionRequestSchema>;
  userId: string;
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

  /**
   * The `execute` stream: subscribed before the start is sent, so no frame is missed, and ended on
   * done, stopped or the run's own error. A dropped stream is not resumed; the client polls
   * `GET /runs/:runId` (spec section 7).
   */
  async *streamRun(run: PipelineRunStart): AsyncGenerator<EvaluationV3Event> {
    const { projectId } = run.input;
    try {
      // A personal development agent runs on one person's machine; only they may send it a turn.
      await run.ownership.assertConnectedAgentsRunnable({
        agents: [...run.data.loadedAgents.values()],
        actor: { id: run.userId, label: "user" },
      });
      for await (const frame of this.#frames(run)) {
        yield frame;
        if (frame.type === "done" || frame.type === "stopped") {
          this.observer.recordExperimentRan({
            userId: run.userId,
            projectId,
            experimentId: run.input.experimentId,
            isFullRun: run.input.scope.type === "full",
          });
        }
      }
    } catch (error) {
      logger.error({ error, projectId }, "Pipeline run error");
      this.observer.reportError(error, { projectId });
      yield mapThrownErrorEvent({ error });
    }
  }

  /** The run's frames in `seq` order, a redelivered one dropped, until the run ends. */
  async *#frames(run: PipelineRunStart): AsyncGenerator<EvaluationV3Event> {
    const { runId, experimentId } = run.start;
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
      if (experimentId !== "") await this.#carryBoard({ run });

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
        if (next.seq <= seen) continue;

        seen = next.seq;
        yield next.frame;
        ended = endsRun(next.frame);
      }
    } finally {
      await unsubscribe();
    }
  }

  /** The board cells the page carried into the run, recorded as the run's and never streamed. */
  async #carryBoard({ run }: { run: PipelineRunStart }): Promise<void> {
    await ExperimentCarriedBoardService.create({
      commands: this.experiments,
      dispatches: ExperimentResultDispatchService.create(),
    }).recordCarriedOverBoard({
      projectId: run.input.projectId,
      runId: run.start.runId,
      experimentId: run.start.experimentId,
      cells: run.input.carriedOverCells ?? [],
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
