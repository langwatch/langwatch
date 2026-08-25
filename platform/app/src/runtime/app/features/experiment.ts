import type { ExperimentService } from "@langwatch/experiment-contract";
import {
  ExperimentDspyRetentionPort,
  PostgresExperimentAdapter,
  type PostgresExperimentAdapterOptions,
} from "@langwatch/experiment-server";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { RetentionPolicyResolver } from "~/server/data-retention/retentionPolicyResolver";

export type AppExperimentRuntimeOptions = PostgresExperimentAdapterOptions;

export class AppExperimentDspyRetentionPort extends ExperimentDspyRetentionPort {
  static create(resolver: RetentionPolicyResolver): AppExperimentDspyRetentionPort {
    return new AppExperimentDspyRetentionPort(resolver);
  }

  private constructor(private readonly resolver: RetentionPolicyResolver) {
    super();
  }

  async getTraceRetentionDays(tenantId: string): Promise<number> {
    return (
      (await this.resolver.resolve(tenantId))?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS
    );
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
