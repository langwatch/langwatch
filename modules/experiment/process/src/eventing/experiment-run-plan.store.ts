import type {
  FoldProjectionStore,
  FoldStateRead,
  ProjectionStoreContext,
} from "@langwatch/eventing";

import type {
  ExperimentRunFoldRepository,
  ExperimentRunPlanFoldState,
} from "../repositories/experiment-run-fold.repository.ts";

/** The plan fold's store; a run started without a plan is folded but never stored. */
export class ExperimentRunPlanStore implements FoldProjectionStore<ExperimentRunPlanFoldState> {
  private constructor(private readonly repository: ExperimentRunFoldRepository) {}

  static create(options: { repository: ExperimentRunFoldRepository }): ExperimentRunPlanStore {
    return new ExperimentRunPlanStore(options.repository);
  }

  async store(state: ExperimentRunPlanFoldState, context: ProjectionStoreContext): Promise<void> {
    if (!state.plan) return;

    await this.repository.writePlan({ runKey: context.aggregateId, state });
  }

  get(aggregateId: string): Promise<FoldStateRead<ExperimentRunPlanFoldState>> {
    return this.repository.readPlan({ runKey: aggregateId });
  }
}
