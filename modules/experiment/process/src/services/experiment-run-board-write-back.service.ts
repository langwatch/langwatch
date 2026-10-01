/**
 * Writes a pipeline run's cells back to the workbench board before the run is completed, as main's
 * run did before reporting it ended, once per run; the manager completes only a finished or stopped
 * run. Design: specs/experiment-run-execution.md section 7.
 */
import {
  applyRunEvent,
  emptyRunResultsDraft,
  type ExperimentRunPlan,
  type WorkbenchActor,
} from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";

import type { ExperimentRunFoldRepository } from "../repositories/experiment-run-fold.repository.ts";
import { hasExperiment, makeExperimentRunKey } from "../rules/experiment-run-key.rules.ts";
import { ExperimentRunResultsWriterService } from "./experiment-run-results-writer.service.ts";
import type { ExperimentWorkbenchService } from "./experiment-workbench.service.ts";

const logger = createLogger("langwatch:experiment:run-board-write-back");

type BoardWriteExperiments = Pick<
  ExperimentWorkbenchService,
  "getWorkbenchState" | "recordWorkbenchRunResults" | "hasWorkbenchVersionOfRun"
>;

type ExperimentRunBoardWriteBackDeps = {
  folds: ExperimentRunFoldRepository;
  experiments: BoardWriteExperiments;
};

export class ExperimentRunBoardWriteBackService {
  static create(deps: ExperimentRunBoardWriteBackDeps): ExperimentRunBoardWriteBackService {
    return new ExperimentRunBoardWriteBackService(deps);
  }

  private readonly folds: ExperimentRunFoldRepository;
  private readonly experiments: BoardWriteExperiments;

  private constructor(deps: ExperimentRunBoardWriteBackDeps) {
    this.folds = deps.folds;
    this.experiments = deps.experiments;
  }

  /**
   * The run's kept result frames, folded into main's draft and merged into the board. Throws while
   * the progress fold has fewer finished cells than the manager counted, so the intent retries; its
   * last attempt writes what is folded rather than leave the run uncompleted.
   */
  async writeBack({
    runId,
    experimentId,
    finishedCells,
    lastAttempt,
  }: {
    runId: string;
    experimentId: string;
    finishedCells: number;
    lastAttempt: boolean;
  }): Promise<void> {
    if (!hasExperiment(experimentId)) return;

    const planRead = await this.folds.readPlan({
      runKey: makeExperimentRunKey(experimentId, runId),
    });
    const plan = planRead.kind === "folded" ? planRead.state.plan : null;
    if (!plan?.persistResults) return;

    const progressRead = await this.folds.readRunProgress({ runId });
    const progress =
      progressRead.kind === "folded" && progressRead.state.experimentId === experimentId
        ? progressRead.state
        : undefined;
    const folded = progress?.progress ?? 0;
    if (folded < finishedCells) {
      if (!lastAttempt) {
        throw new Error(`Run ${runId} has finished cells whose results are not folded yet`);
      }
      logger.warn(
        { runId, folded, finishedCells },
        "Writing a run's board before its fold caught up",
      );
    }
    if (!progress) return;
    const written = await this.experiments.hasWorkbenchVersionOfRun({
      projectId: progress.projectId,
      experimentId,
      runId,
    });
    if (written) {
      logger.info({ runId, experimentId }, "The board's history already holds this run's write");
      return;
    }

    // Named for the run, as main's draft was; the write names the run in the version history.
    const draft = { ...emptyRunResultsDraft(), runId };
    for (const frame of Object.values(progress.resultFrames))
      applyRunEvent({ draft, event: frame });

    await ExperimentRunResultsWriterService.persistRunResults({
      persistence: { experiments: this.experiments, actor: workbenchActorOf(plan) },
      projectId: progress.projectId,
      experimentId,
      runId,
      scope: plan.scope,
      draft,
    });
  }
}

/** Who the board write is attributed to: whoever the plan credits, else the API. */
function workbenchActorOf(plan: ExperimentRunPlan): WorkbenchActor {
  return plan.actor ?? { label: "api" };
}
