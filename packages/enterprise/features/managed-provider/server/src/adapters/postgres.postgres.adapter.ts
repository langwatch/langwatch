import type { ManagedProviderService as ManagedProviderServiceContract } from "@langwatch/enterprise-managed-provider-contract";
import type { ManagedProviderConfigurationPort } from "../ports/managed-provider-configuration.port";
import type { ManagedProviderCredentialsPort } from "../ports/managed-provider-credentials.port";
import { PrismaManagedProviderProjectRepository } from "../repositories/prisma/prisma.project-organization.repository";
import { ManagedProviderService } from "../services/managed-provider.service";

/** Composes the managed-provider capability around its private project read. */
export class PostgresManagedProviderAdapter {
  private constructor(
    private readonly options: {
      database: object;
      configuration: ManagedProviderConfigurationPort;
      credentials: ManagedProviderCredentialsPort;
    },
  ) {}

  static create(options: {
    database: object;
    configuration: ManagedProviderConfigurationPort;
    credentials: ManagedProviderCredentialsPort;
  }): PostgresManagedProviderAdapter {
    return new PostgresManagedProviderAdapter(options);
  }

  build(): ManagedProviderServiceContract {
    return ManagedProviderService.create({
      configuration: this.options.configuration,
      credentials: this.options.credentials,
      projects: PrismaManagedProviderProjectRepository.create(
        this.options.database,
      ),
    });
  }
}
