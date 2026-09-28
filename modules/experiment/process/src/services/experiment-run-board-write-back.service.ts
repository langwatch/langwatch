/**
 * Writes a pipeline run's cells back to the workbench board once it ends finished or stopped, as
 * main's run did before reporting it ended; a failed run writes nothing. Design:
 * specs/experiment-run-execution.md section 7.
 */
import {
  applyRunEvent,
  emptyRunResultsDraft,
  type ExperimentRunPlan,
  type WorkbenchActor,
} from "@langwatch/experiment-contract";

import type {
  ExperimentRunFoldRepository,
  ExperimentRunProgressState,
} from "../repositories/experiment-run-fold.repository.ts";
import {
  ExperimentRunResultsWriterService,
  type RunResultsPersistence,
} from "./experiment-run-results-writer.service.ts";

type ExperimentRunBoardWriteBackDeps = {
  folds: ExperimentRunFoldRepository;
  experiments: RunResultsPersistence["experiments"];
};

export class ExperimentRunBoardWriteBackService {
  static create(deps: ExperimentRunBoardWriteBackDeps): ExperimentRunBoardWriteBackService {
    return new ExperimentRunBoardWriteBackService(deps);
  }

  private readonly folds: ExperimentRunFoldRepository;
  private readonly experiments: RunResultsPersistence["experiments"];

  private constructor(deps: ExperimentRunBoardWriteBackDeps) {
    this.folds = deps.folds;
    this.experiments = deps.experiments;
  }

  /** The run's kept result frames, folded into main's draft and merged into the board. */
  async writeBack({
    runKey,
    progress,
  }: {
    runKey: string;
    progress: ExperimentRunProgressState;
  }): Promise<void> {
    if (!progress.persistResults) return;
    if (progress.status !== "completed" && progress.status !== "stopped") return;

    const read = await this.folds.readPlan({ runKey });
    if (read.kind === "empty" || !read.state.plan) return;

    const draft = emptyRunResultsDraft();
    for (const frame of Object.values(progress.resultFrames))
      applyRunEvent({ draft, event: frame });

    await ExperimentRunResultsWriterService.persistRunResults({
      persistence: { experiments: this.experiments, actor: workbenchActorOf(read.state.plan) },
      projectId: progress.projectId,
      experimentId: progress.experimentId,
      runId: progress.runId,
      scope: read.state.plan.scope,
      draft,
    });
  }
}

/** Who the board write is attributed to: the person who started the run, else the API. */
function workbenchActorOf(plan: ExperimentRunPlan): WorkbenchActor {
  if (!plan.actor) return { label: "api" };
  return { userId: plan.actor.id, label: plan.actor.label === "user" ? "user" : "api" };
}
