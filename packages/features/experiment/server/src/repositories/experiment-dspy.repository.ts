import type {
  ExperimentDspyStep,
  ExperimentDspyStepLookup,
  ExperimentDspyStepSummary,
  ExperimentDspyStepsLookup,
} from "@langwatch/experiment-contract";

export abstract class ExperimentDspyRepository {
  abstract upsert(input: ExperimentDspyStep): Promise<void>;
  abstract list(
    input: ExperimentDspyStepsLookup,
  ): Promise<ExperimentDspyStepSummary[]>;
  abstract tryGet(
    input: ExperimentDspyStepLookup,
  ): Promise<ExperimentDspyStep | null>;
}
