import {
  ManagedProviderApi,
  type ManagedProviderApi as ManagedProviderApiContract,
  managedProviderSecrets,
  parseManagedBedrockDirectory,
} from "@langwatch/enterprise-managed-provider-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { ProjectApi } from "@langwatch/project-contract";

import { HttpManagedProviderCredentialsChannel } from "../channels/http/http.managed-provider-credentials.channel.ts";
import { ManagedProviderConfigurationService } from "../services/managed-provider-configuration.service.ts";
import { ManagedProviderService } from "../services/managed-provider.service.ts";

/** The directory is a credential (ADR-132): this App's own declared secret, not config. */
type ManagedProviderSetup = FeatureSetup<typeof ManagedProviderApp.dependencies, never, undefined>;

export class ManagedProviderApp implements ManagedProviderApiContract {
  static readonly contract = ManagedProviderApi;
  static readonly dependencies = { projects: ProjectApi };
  static readonly secrets = managedProviderSecrets;

  readonly #service: ManagedProviderService;

  private constructor(service: ManagedProviderService) {
    this.#service = service;
  }

  static async create({
    secrets,
    dependencies,
  }: ManagedProviderSetup): Promise<ManagedProviderApp> {
    const bedrock = await secrets.into(
      managedProviderSecrets.bedrock,
      parseManagedBedrockDirectory,
    );
    return new ManagedProviderApp(
      ManagedProviderService.create({
        configuration: ManagedProviderConfigurationService.create({ bedrock }),
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
