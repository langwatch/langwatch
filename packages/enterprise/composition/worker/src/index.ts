import { EnterpriseCatalogue } from "@langwatch/enterprise";
import type { ManagedProviderService } from "@langwatch/enterprise-managed-provider-contract";
import type {
  ManagedProviderConfigurationPort,
  ManagedProviderCredentialsPort,
  ManagedProviderProjectRepository,
} from "@langwatch/enterprise-managed-provider-server";
import { PostgresManagedProviderAdapter } from "@langwatch/enterprise-managed-provider-server";

export type EnterpriseWorkerCompositionOptions = {
  managedProvider: {
    projects: ManagedProviderProjectRepository;
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
