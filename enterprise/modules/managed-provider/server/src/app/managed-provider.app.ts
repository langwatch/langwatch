import {
  ManagedProviderApi,
  type ManagedProviderApi as ManagedProviderApiContract,
} from "@langwatch/enterprise-managed-provider-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { HttpManagedProviderCredentialsChannel } from "../channels/http/http.managed-provider-credentials.channel.ts";
import {
  ManagedProviderConfigurationService,
  type ManagedProviderConfigurationReporter,
} from "../services/managed-provider-configuration.service.ts";
import { ManagedProviderService } from "../services/managed-provider.service.ts";

export type ManagedProviderInfrastructure = Readonly<{
  source: Readonly<Record<string, string | undefined>>;
  reporter: ManagedProviderConfigurationReporter;
}>;

type ManagedProviderSetup = FeatureSetup<
  Readonly<{ projects: typeof ProjectApi }>,
  ManagedProviderInfrastructure,
  undefined
>;

export class ManagedProviderApp implements ManagedProviderApiContract {
  static readonly contract = ManagedProviderApi;
  static readonly dependencies = { projects: ProjectApi };

  readonly #service: ManagedProviderService;

  private constructor(service: ManagedProviderService) {
    this.#service = service;
  }

  static create({ members, dependencies }: ManagedProviderSetup): ManagedProviderApp {
    const configuration = ManagedProviderConfigurationService.create({
      source: members.source,
      reporter: members.reporter,
    });
    const credentials = HttpManagedProviderCredentialsChannel.create();

    return new ManagedProviderApp(
      ManagedProviderService.create({
        configuration,
        credentials,
        projects: dependencies.projects,
      }),
    );
  }

  isManagedProvider: ManagedProviderApiContract["isManagedProvider"] = (input) =>
    this.#service.isManagedProvider(input);

  buildLitellmParameters: ManagedProviderApiContract["buildLitellmParameters"] = (input) =>
    this.#service.buildLitellmParameters(input);
}
