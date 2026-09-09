import {
  ManagedProviderApi,
  type ManagedProviderApi as ManagedProviderApiContract,
} from "@langwatch/enterprise-managed-provider-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { AwsStsManagedProviderCredentialAdapter } from "../adapters/aws-sts.aws-sts.adapter.ts";
import { EnvironmentManagedProviderConfigurationAdapter } from "../adapters/environment-config.environment-config.adapter.ts";
import type { ManagedProviderConfigurationReporter } from "../ports/managed-provider-configuration.port.ts";
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

  static create({ infrastructure, dependencies }: ManagedProviderSetup): ManagedProviderApp {
    const configuration = EnvironmentManagedProviderConfigurationAdapter.create({
      source: infrastructure.source,
      reporter: infrastructure.reporter,
    });
    const credentials = AwsStsManagedProviderCredentialAdapter.create();

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
