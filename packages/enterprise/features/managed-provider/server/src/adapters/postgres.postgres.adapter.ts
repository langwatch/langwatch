import type { ManagedProviderService as ManagedProviderServiceContract } from "@langwatch/enterprise-managed-provider-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { ManagedProviderConfigurationPort } from "../ports/managed-provider-configuration.port";
import type { ManagedProviderCredentialsPort } from "../ports/managed-provider-credentials.port";
import { ManagedProviderService } from "../services/managed-provider.service";

/** Composes managed providers around the process-owned Project service. */
export class PostgresManagedProviderAdapter {
  private constructor(
    private readonly options: {
      projects: ProjectService;
      configuration: ManagedProviderConfigurationPort;
      credentials: ManagedProviderCredentialsPort;
    },
  ) {}

  static create(options: {
    projects: ProjectService;
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
