import type { FoldStateRead } from "@langwatch/eventing";

import {
  ExperimentRunFoldRepository,
  type ExperimentRunPlanFoldState,
  type ExperimentRunProgressState,
} from "../experiment-run-fold.repository.ts";

/** The run's folds in this process's memory, for tests and a deployment without Redis. */
export class MemoryExperimentRunFoldRepository extends ExperimentRunFoldRepository {
  static create(): MemoryExperimentRunFoldRepository {
    return new MemoryExperimentRunFoldRepository();
  }

  private readonly plans = new Map<string, ExperimentRunPlanFoldState>();
  private readonly progress = new Map<string, ExperimentRunProgressState>();

  private constructor() {
    super();
  }

  readPlan({ runKey }: { runKey: string }): Promise<FoldStateRead<ExperimentRunPlanFoldState>> {
    return Promise.resolve(folded(this.plans.get(runKey)));
  }

  writePlan({
    runKey,
    state,
  }: {
    runKey: string;
    state: ExperimentRunPlanFoldState;
  }): Promise<void> {
    this.plans.set(runKey, state);
    return Promise.resolve();
  }

  readRunProgress({
    runId,
  }: {
    runId: string;
  }): Promise<FoldStateRead<ExperimentRunProgressState>> {
    return Promise.resolve(folded(this.progress.get(runId)));
  }

  writeProgress({ state }: { state: ExperimentRunProgressState }): Promise<void> {
    this.progress.set(state.runId, state);
    return Promise.resolve();
  }
}

function folded<State>(state: State | undefined): FoldStateRead<State> {
  return state === undefined ? { kind: "empty" } : { kind: "folded", state };
}
