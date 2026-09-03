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
