import type { ExperimentService } from "@langwatch/experiment-contract";
import {
  ExperimentDspyRetentionPort,
  PostgresExperimentAdapter,
  type PostgresExperimentAdapterOptions,
} from "@langwatch/experiment-server";
import type { DataRetentionService } from "@langwatch/data-retention-contract";

export type AppExperimentRuntimeOptions = PostgresExperimentAdapterOptions;

export class AppExperimentDspyRetentionPort extends ExperimentDspyRetentionPort {
  static create(resolver: DataRetentionService): AppExperimentDspyRetentionPort {
    return new AppExperimentDspyRetentionPort(resolver);
  }

  private constructor(private readonly resolver: DataRetentionService) {
    super();
  }

  async getTraceRetentionDays(tenantId: string): Promise<number> {
    const retention = await this.resolver.getResolvedForProject({ projectId: tenantId });
    return retention.traces;
  }
}

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
