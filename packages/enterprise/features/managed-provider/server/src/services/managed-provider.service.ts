import {
  type BuildManagedProviderParametersInput,
  ManagedProviderService as ManagedProviderServiceContract,
} from "@langwatch/enterprise-managed-provider-contract";
import type { ManagedProviderConfigurationPort } from "../ports/managed-provider-configuration.port";
import type { ManagedProviderCredentialsPort } from "../ports/managed-provider-credentials.port";
import type { ManagedProviderProjectRepository } from "../ports/managed-provider-project.port";

export class ManagedProviderService extends ManagedProviderServiceContract {
  private readonly projectOrganizations = new Map<string, string>();

  private constructor(
    private readonly configuration: ManagedProviderConfigurationPort,
    private readonly projects: ManagedProviderProjectRepository,
    private readonly credentials: ManagedProviderCredentialsPort,
  ) {
    super();
  }

  static create(options: {
    configuration: ManagedProviderConfigurationPort;
    projects: ManagedProviderProjectRepository;
    credentials: ManagedProviderCredentialsPort;
  }): ManagedProviderService {
    return new ManagedProviderService(
      options.configuration,
      options.projects,
      options.credentials,
    );
  }

  isManagedProvider(organizationId: string, provider: string): boolean {
    return (
      provider === "bedrock" &&
      this.configuration.tryForOrganization(organizationId) !== null
    );
  }

  async buildLitellmParameters(
    input: BuildManagedProviderParametersInput,
  ): Promise<Record<string, string>> {
    if (input.modelProvider.provider !== "bedrock") return input.params;

    const organizationId = await this.tryOrganizationForProject(input.projectId);
    if (!organizationId) return input.params;
    const config = this.configuration.tryForOrganization(organizationId);
    if (!config) return input.params;

    const credentials = await this.credentials.assumeCustomerRole(config);
    input.params.aws_access_key_id = credentials.accessKeyId;
    input.params.aws_secret_access_key = credentials.secretAccessKey;
    input.params.aws_session_token = credentials.sessionToken;
    input.params.aws_region_name = config.region;
    input.params.aws_bedrock_runtime_endpoint =
      config.bedrockProxyEndpoint.startsWith("http://") ||
      config.bedrockProxyEndpoint.startsWith("https://")
        ? config.bedrockProxyEndpoint
        : `http://${config.bedrockProxyEndpoint}`;
    delete input.params.api_key;
    return input.params;
  }

  clearProjectOrganizationCache(): void {
    this.projectOrganizations.clear();
  }

  private async tryOrganizationForProject(projectId: string): Promise<string | null> {
    const cached = this.projectOrganizations.get(projectId);
    if (cached) return cached;
    const organizationId = await this.projects.tryGetOrganizationId(projectId);
    if (organizationId) this.projectOrganizations.set(projectId, organizationId);
    return organizationId;
  }
}
