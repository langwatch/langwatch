import { ExperimentWorkbenchUpdatesPort } from "../ports/experiment-workbench-updates.port";

/** Drops workbench update notices where no live update transport is composed. */
export class NoopExperimentWorkbenchUpdatesAdapter extends ExperimentWorkbenchUpdatesPort {
  async publish(): Promise<void> {}
}
