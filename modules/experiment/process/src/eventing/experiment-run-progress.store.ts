import type {
  FoldProjectionStore,
  FoldStateRead,
  ProjectionStoreContext,
} from "@langwatch/eventing";

import type {
  ExperimentRunFoldRepository,
  ExperimentRunProgressState,
} from "../repositories/experiment-run-fold.repository.ts";
import { parseExperimentRunKey } from "../rules/experiment-run-key.rules.ts";

/**
 * The progress fold's store, at main's poller key by runId; a run started without a plan is
 * folded but never stored. Another experiment's run under the same runId reads as empty.
 */
export class ExperimentRunProgressStore implements FoldProjectionStore<ExperimentRunProgressState> {
  private constructor(private readonly repository: ExperimentRunFoldRepository) {}

  static create(options: { repository: ExperimentRunFoldRepository }): ExperimentRunProgressStore {
    return new ExperimentRunProgressStore(options.repository);
  }

  async store(state: ExperimentRunProgressState, _context: ProjectionStoreContext): Promise<void> {
    if (!state.planned) return;

    await this.repository.writeProgress({ state });
  }

  async get(aggregateId: string): Promise<FoldStateRead<ExperimentRunProgressState>> {
    const { experimentId, runId } = parseExperimentRunKey(aggregateId);
    const read = await this.repository.readRunProgress({ runId });
    if (read.kind === "folded" && read.state.experimentId !== experimentId) {
      return { kind: "empty" };
    }

    return read;
  }
}
