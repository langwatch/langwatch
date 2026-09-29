/**
 * Main registered a run before answering its start. The progress fold is the run's one writer,
 * so a start is answered once the fold holds the run (spec section 7).
 */
import { ExperimentRunLoopUnavailableError } from "@langwatch/experiment-contract";

import type { ExperimentRunFoldRepository } from "../repositories/experiment-run-fold.repository.ts";

/** How often the fold is read, and how many times, before the start is refused: five seconds. */
const REGISTRATION_POLL_MS = 100;
const REGISTRATION_POLLS = 50;

export class ExperimentRunRegistrationService {
  static create(deps: { folds: ExperimentRunFoldRepository }): ExperimentRunRegistrationService {
    return new ExperimentRunRegistrationService(deps.folds);
  }

  private constructor(private readonly folds: ExperimentRunFoldRepository) {}

  /** Resolves once the run is readable by its id; refuses as an unavailable backend after 5 s. */
  async awaitRegistered({
    runId,
    experimentId,
  }: {
    runId: string;
    experimentId: string;
  }): Promise<void> {
    for (let poll = 0; poll < REGISTRATION_POLLS; poll++) {
      const read = await this.folds.readRunProgress({ runId });
      if (read.kind === "folded" && read.state.experimentId === experimentId) return;

      await new Promise((resolve) => setTimeout(resolve, REGISTRATION_POLL_MS));
    }

    throw new ExperimentRunLoopUnavailableError({
      capability: "worker that registered the run in time",
    });
  }
}
