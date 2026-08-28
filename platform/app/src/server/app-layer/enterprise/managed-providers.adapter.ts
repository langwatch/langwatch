import {
  AwsStsManagedProviderCredentialAdapter,
  ManagedProviderConfigurationReporter,
  EnvironmentManagedProviderConfigurationAdapter,
  PostgresManagedProviderAdapter,
} from "~/runtime/app/features/managed-providers";
import type { ManagedProviderService } from "@langwatch/enterprise-managed-provider-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:managed-providers:bedrock");

class AppManagedProviderConfigurationReporter extends ManagedProviderConfigurationReporter {
  private constructor() {
    super();
  }

  static create(): AppManagedProviderConfigurationReporter {
    return new AppManagedProviderConfigurationReporter();
  }

  info(attributes: Record<string, unknown>, message: string): void {
    logger.info(attributes, message);
  }

  warn(attributes: Record<string, unknown>, message: string): void {
    logger.warn(attributes, message);
  }
}

export class ManagedProvidersAppAdapter {
  private constructor(readonly service: ManagedProviderService) {}

  static create(options: {
    projects: ProjectService;
    environment: Readonly<Record<string, string | undefined>>;
  }): ManagedProvidersAppAdapter {
    return new ManagedProvidersAppAdapter(
      PostgresManagedProviderAdapter.create({
        projects: options.projects,
        configuration: EnvironmentManagedProviderConfigurationAdapter.create({
          source: options.environment,
          reporter: AppManagedProviderConfigurationReporter.create(),
        }),
        credentials: AwsStsManagedProviderCredentialAdapter.create(),
      }).build(),
    );
  }
}
