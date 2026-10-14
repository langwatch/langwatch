import type {
  ExperimentDspyStep,
  ExperimentDspyStepLookup,
  ExperimentDspyStepSummary,
  ExperimentDspyStepsLookup,
} from "@langwatch/experiment-contract";

import type { ExperimentDspyRetentionRepository } from "./experiment-dspy-retention.repository.ts";

export abstract class ExperimentDspyRepository {
  /** Stamps the row with the tenant's retention, read only once the row is to be written. */
  abstract upsert(input: {
    step: ExperimentDspyStep;
    retention: ExperimentDspyRetentionRepository;
  }): Promise<void>;
  abstract findAll(input: ExperimentDspyStepsLookup): Promise<ExperimentDspyStepSummary[]>;
  abstract findStep(input: ExperimentDspyStepLookup): Promise<ExperimentDspyStep | null>;
}
