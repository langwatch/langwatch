import type { IdIndexFlags } from "@langwatch/clickhouse-client";
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
    idIndex?: IdIndexFlags | undefined;
  }): Promise<void>;
  /** With `idIndex` on, an experiment's steps are read only in the weeks its id index names. */
  abstract findAll(
    input: ExperimentDspyStepsLookup & { idIndex?: IdIndexFlags | undefined },
  ): Promise<ExperimentDspyStepSummary[]>;
  abstract findStep(
    input: ExperimentDspyStepLookup & { idIndex?: IdIndexFlags | undefined },
  ): Promise<ExperimentDspyStep | null>;
}
