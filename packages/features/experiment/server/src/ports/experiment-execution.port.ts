import type {
  CompleteExperimentRunInput,
  RecordEvaluatorResultInput,
  RecordTargetResultInput,
  StartExperimentRunInput,
} from "@langwatch/experiment-contract";

/**
 * Private boundary between the canonical Experiment service and the app's
 * Eventing pipeline. The feature owns validation; this port only dispatches
 * already-valid commands with their original IDs and timestamps unchanged.
 */
export abstract class ExperimentExecutionPort {
  abstract startExperimentRun(input: StartExperimentRunInput): Promise<void>;
  abstract recordTargetResult(input: RecordTargetResultInput): Promise<void>;
  abstract recordEvaluatorResult(input: RecordEvaluatorResultInput): Promise<void>;
  abstract completeExperimentRun(input: CompleteExperimentRunInput): Promise<void>;
}

export class UnavailableExperimentExecutionPort extends ExperimentExecutionPort {
  private unavailable(): never {
    throw new Error(
      "Experiment execution is not configured for this application instance",
    );
  }

  async startExperimentRun(_input: StartExperimentRunInput): Promise<void> {
    this.unavailable();
  }

  async recordTargetResult(_input: RecordTargetResultInput): Promise<void> {
    this.unavailable();
  }

  async recordEvaluatorResult(_input: RecordEvaluatorResultInput): Promise<void> {
    this.unavailable();
  }

  async completeExperimentRun(_input: CompleteExperimentRunInput): Promise<void> {
    this.unavailable();
  }
}
