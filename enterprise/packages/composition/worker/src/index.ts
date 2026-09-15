import { EnterpriseCatalogue } from "@langwatch/enterprise";

import type {
  ManagedProviderConfiguration,
  ManagedProviderCredentialVendor,
} from "@langwatch/enterprise-managed-provider-server";
import { ManagedProviderService } from "@langwatch/enterprise-managed-provider-server";
import type { ProjectApi } from "@langwatch/project-contract";

export type EnterpriseWorkerCompositionOptions = {
  managedProvider: {
    projects: ProjectApi;
    configuration: ManagedProviderConfiguration;
    credentials: ManagedProviderCredentialVendor;
  };
};

/** Worker-only Enterprise composition with explicitly supplied feature ports. */
export class EnterpriseWorkerComposition {
  private constructor(
    readonly catalogue: EnterpriseCatalogue,
    readonly managedProviders: ManagedProviderService | undefined,
  ) {}

  static create(): EnterpriseWorkerComposition;
  static create(
    options: EnterpriseWorkerCompositionOptions,
  ): EnterpriseWorkerComposition & { readonly managedProviders: ManagedProviderService };
  static create(options?: EnterpriseWorkerCompositionOptions): EnterpriseWorkerComposition {
    const managedProviders = options
      ? ManagedProviderService.create({
          configuration: options.managedProvider.configuration,
          projects: options.managedProvider.projects,
          credentials: options.managedProvider.credentials,
        })
      : undefined;

    return new EnterpriseWorkerComposition(EnterpriseCatalogue.create(), managedProviders);
  }
}

export {
  GovernanceIngestionAws,
  GovernanceIngestionEgress,
  INGESTION_PULL_DURATION_METRIC_NAME,
  INGESTION_PULL_TOTAL_METRIC_NAME,
  OtelGovernanceIngestionPullMetrics,
  UtcGovernanceIngestionPullSchedule,
  WorkerGovernanceIngestionPullHost,
  currentRegistryRateVersion,
  type WorkerGovernanceIngestionPullHostOptions,
} from "./governance/governance-ingestion-pull.host.ts";

export {
  startSpendSpikeAnomalyWorker,
  type SpendSpikeAnomalyWorkerDependencies,
  type SpendSpikeAnomalyWorkerHandle,
} from "./governance/spend-spike-anomaly.worker.ts";

export { EnterpriseWorkerAuditLog } from "./audit-log.composition.ts";
