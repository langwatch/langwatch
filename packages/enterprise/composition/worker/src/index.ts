import { EnterpriseCatalogue } from "@langwatch/enterprise";
import type { ManagedProviderService } from "@langwatch/enterprise-managed-provider-contract";
import type {
  ManagedProviderConfigurationPort,
  ManagedProviderCredentialsPort,
} from "@langwatch/enterprise-managed-provider-server";
import { PostgresManagedProviderAdapter } from "@langwatch/enterprise-managed-provider-server";
import type { ProjectService } from "@langwatch/project-contract";

export type EnterpriseWorkerCompositionOptions = {
  managedProvider: {
    projects: ProjectService;
    configuration: ManagedProviderConfigurationPort;
    credentials: ManagedProviderCredentialsPort;
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
      ? PostgresManagedProviderAdapter.create({
          projects: options.managedProvider.projects,
          configuration: options.managedProvider.configuration,
          credentials: options.managedProvider.credentials,
        }).build()
      : undefined;

    return new EnterpriseWorkerComposition(EnterpriseCatalogue.create(), managedProviders);
  }
}

export {
  GovernanceIngestionAwsPort,
  GovernanceIngestionEgressPort,
  INGESTION_PULL_DURATION_METRIC_NAME,
  INGESTION_PULL_TOTAL_METRIC_NAME,
  OtelGovernanceIngestionPullMetrics,
  UtcGovernanceIngestionPullSchedule,
  WorkerGovernanceIngestionPullHost,
  currentRegistryRateVersion,
  type WorkerGovernanceIngestionPullHostOptions,
} from "./governance/governance-ingestion-pull.host";
