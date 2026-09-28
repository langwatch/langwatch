import type {
  FoldProjectionStore,
  FoldStateRead,
  ProjectionStoreContext,
} from "@langwatch/eventing";

import type {
  ExperimentRunFoldRepository,
  ExperimentRunProgressState,
} from "../repositories/experiment-run-fold.repository.ts";

/** The progress fold's store; a run started without a plan is folded but never stored. */
export class ExperimentRunProgressStore implements FoldProjectionStore<ExperimentRunProgressState> {
  private constructor(private readonly repository: ExperimentRunFoldRepository) {}

  static create(options: { repository: ExperimentRunFoldRepository }): ExperimentRunProgressStore {
    return new ExperimentRunProgressStore(options.repository);
  }

  async store(state: ExperimentRunProgressState, context: ProjectionStoreContext): Promise<void> {
    if (!state.planned) return;

    await this.repository.writeProgress({
      runKey: context.aggregateId,
      state,
    });
  }

  get(aggregateId: string): Promise<FoldStateRead<ExperimentRunProgressState>> {
    return this.repository.readProgress({ runKey: aggregateId });
  }
}
