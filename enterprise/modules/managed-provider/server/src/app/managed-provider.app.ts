import {
  ManagedProviderApi,
  type ManagedProviderApi as ManagedProviderApiContract,
  managedProviderAppConfigSchema,
  type ManagedProviderAppConfig,
} from "@langwatch/enterprise-managed-provider-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { HttpManagedProviderCredentialsChannel } from "../channels/http/http.managed-provider-credentials.channel.ts";
import { ManagedProviderConfigurationService } from "../services/managed-provider-configuration.service.ts";
import { ManagedProviderService } from "../services/managed-provider.service.ts";

/**
 * The module reads no process member: a managed Bedrock call needs the
 * directory it was configured with and the customer's own AWS roles, and
 * nothing this process owns.
 */
type ManagedProviderSetup = FeatureSetup<
  typeof ManagedProviderApp.dependencies,
  never,
  ManagedProviderAppConfig
>;

export class ManagedProviderApp implements ManagedProviderApiContract {
  static readonly contract = ManagedProviderApi;
  static readonly dependencies = { projects: ProjectApi };
  static readonly configSchema = managedProviderAppConfigSchema;

  readonly #service: ManagedProviderService;

  private constructor(service: ManagedProviderService) {
    this.#service = service;
  }

  static create({ config, dependencies }: ManagedProviderSetup): ManagedProviderApp {
    return new ManagedProviderApp(
      ManagedProviderService.create({
        configuration: ManagedProviderConfigurationService.create({ bedrock: config.bedrock }),
        credentials: HttpManagedProviderCredentialsChannel.create(),
        projects: dependencies.projects,
      }),
    );
  }

  isManagedProvider: ManagedProviderApiContract["isManagedProvider"] = (input) =>
    this.#service.isManagedProvider(input);

  buildLitellmParameters: ManagedProviderApiContract["buildLitellmParameters"] = (input) =>
    this.#service.buildLitellmParameters(input);
}
