import { ExperimentWorkbenchUpdatesPort } from "../ports/experiment-workbench-updates.port";

/** Drops workbench update notices where no live update transport is composed. */
export class NoopExperimentWorkbenchUpdatesAdapter extends ExperimentWorkbenchUpdatesPort {
  static create(): NoopExperimentWorkbenchUpdatesAdapter {
    return new NoopExperimentWorkbenchUpdatesAdapter();
  }

  async publish(): Promise<void> {}
}
