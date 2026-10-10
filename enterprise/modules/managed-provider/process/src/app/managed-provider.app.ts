import {
  ManagedProviderApi,
  type ManagedProviderApi as ManagedProviderApiContract,
  managedProviderSecrets,
  parseManagedBedrockDirectory,
} from "@langwatch/enterprise-managed-provider-contract";
import type { FeatureSetup } from "@langwatch/process";

import type { ManagedProviderChannels } from "../channels/managed-provider.channels.ts";
import { ManagedProviderConfigurationService } from "../services/managed-provider-configuration.service.ts";
import { ManagedProviderService } from "../services/managed-provider.service.ts";

/** The directory is a credential (ADR-132): this App's own declared secret, not config. */
type ManagedProviderSetup = FeatureSetup<
  typeof ManagedProviderModule.dependencies,
  undefined,
  never,
  ManagedProviderChannels
>;

export class ManagedProviderModule implements ManagedProviderApiContract {
  static readonly contract = ManagedProviderApi;
  static readonly dependencies = {};
  static readonly secrets = managedProviderSecrets;

  readonly #service: ManagedProviderService;

  private constructor(service: ManagedProviderService) {
    this.#service = service;
  }

  static async create({ secrets, channels }: ManagedProviderSetup): Promise<ManagedProviderModule> {
    const bedrock = await secrets.into(
      managedProviderSecrets.bedrock,
      parseManagedBedrockDirectory,
    );
    return new ManagedProviderModule(
      ManagedProviderService.create({
        configuration: ManagedProviderConfigurationService.create({ bedrock }),
        credentials: channels.credentials,
      }),
    );
  }

  isManagedProvider: ManagedProviderApiContract["isManagedProvider"] = (input) =>
    this.#service.isManagedProvider(input);

  buildLitellmParameters: ManagedProviderApiContract["buildLitellmParameters"] = (input) =>
    this.#service.buildLitellmParameters(input);
}
