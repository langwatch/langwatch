import type {
  CompleteExperimentRunInput,
  RecordEvaluatorResultInput,
  RecordTargetResultInput,
  StartExperimentRunInput,
} from "@langwatch/experiment-contract";
import type { AppCommands } from "~/server/event-sourcing/registration/pipelineRegistry";

type ExperimentRunCommands = Pick<
  AppCommands["experimentRuns"],
  | "startExperimentRun"
  | "recordTargetResult"
  | "recordEvaluatorResult"
  | "completeExperimentRun"
>;

/**
 * App-owned Eventing implementation for the package's private execution port.
 * Resolving commands lazily lets the feature service be composed before the
 * pipeline registry has finished registering its command handlers.
 */
export class AppExperimentEventingAdapter {
  static create(
    resolveCommands: () => ExperimentRunCommands,
  ): AppExperimentEventingAdapter {
    return new AppExperimentEventingAdapter(resolveCommands);
  }

  private constructor(
    private readonly resolveCommands: () => ExperimentRunCommands,
  ) {}

  build() {
    return {
      startExperimentRun: (input: StartExperimentRunInput) =>
        this.resolveCommands().startExperimentRun(input),
      recordTargetResult: (input: RecordTargetResultInput) =>
        this.resolveCommands().recordTargetResult(input),
      recordEvaluatorResult: (input: RecordEvaluatorResultInput) =>
        this.resolveCommands().recordEvaluatorResult(input),
      completeExperimentRun: (input: CompleteExperimentRunInput) =>
        this.resolveCommands().completeExperimentRun(input),
    };
  }
}
