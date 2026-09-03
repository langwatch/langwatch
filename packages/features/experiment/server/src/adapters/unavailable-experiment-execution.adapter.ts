import type {
  CompleteExperimentRunInput,
  RecordEvaluatorResultInput,
  RecordTargetResultInput,
  StartExperimentRunInput,
} from "@langwatch/experiment-contract";
import { ExperimentExecutionPort } from "../ports/experiment-execution.port";

/** Refuses execution where the application composes no Eventing pipeline. */
export class UnavailableExperimentExecutionAdapter extends ExperimentExecutionPort {
  private unavailable(): never {
    throw new Error("Experiment execution is not configured for this application instance");
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
