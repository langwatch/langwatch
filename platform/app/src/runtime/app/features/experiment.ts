import type { ExperimentService } from "@langwatch/experiment-contract";
import {
  PostgresExperimentAdapter,
  type PostgresExperimentAdapterOptions,
} from "@langwatch/experiment-server";

export type AppExperimentRuntimeOptions = PostgresExperimentAdapterOptions;

/** Process-owned composition for the canonical Experiment service. */
export class AppExperimentRuntime {
  static create(options: AppExperimentRuntimeOptions): AppExperimentRuntime {
    return new AppExperimentRuntime(options);
  }

  private constructor(private readonly options: AppExperimentRuntimeOptions) {}

  build(): ExperimentService {
    return PostgresExperimentAdapter.create(this.options);
  }
}
