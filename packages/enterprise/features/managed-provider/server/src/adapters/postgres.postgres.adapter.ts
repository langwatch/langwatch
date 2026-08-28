import type { ManagedProviderService as ManagedProviderServiceContract } from "@langwatch/enterprise-managed-provider-contract";
import type { ManagedProviderConfigurationPort } from "../ports/managed-provider-configuration.port";
import type { ManagedProviderCredentialsPort } from "../ports/managed-provider-credentials.port";
import type { ManagedProviderProjectRepository } from "../ports/managed-provider-project.port";
import { ManagedProviderService } from "../services/managed-provider.service";

/** Composes the managed-provider capability around its private project read port. */
export class PostgresManagedProviderAdapter {
  private constructor(
    private readonly options: {
      projects: ManagedProviderProjectRepository;
      configuration: ManagedProviderConfigurationPort;
      credentials: ManagedProviderCredentialsPort;
    },
  ) {}

  static create(options: {
    projects: ManagedProviderProjectRepository;
    configuration: ManagedProviderConfigurationPort;
    credentials: ManagedProviderCredentialsPort;
  }): PostgresManagedProviderAdapter {
    return new PostgresManagedProviderAdapter(options);
  }

  build(): ManagedProviderServiceContract {
    return ManagedProviderService.create({
      configuration: this.options.configuration,
      credentials: this.options.credentials,
      projects: this.options.projects,
    });
  }
}
