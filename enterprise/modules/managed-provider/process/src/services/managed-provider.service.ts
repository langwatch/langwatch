import {
  type BuildManagedProviderParametersInput,
  type ManagedBedrockCredentials,
  type ManagedProviderApi,
} from "@langwatch/enterprise-managed-provider-contract";

import type { ManagedProviderCredentialVendor } from "../channels/managed-provider-credentials.channel.ts";
import type { ManagedProviderConfiguration } from "./managed-provider-configuration.service.ts";

/** Asked to mint for an organization with no managed Bedrock deployment: a caller bug. */
export class ManagedBedrockNotConfiguredError extends Error {
  readonly code = "managed_bedrock_not_configured";

  constructor() {
    super("This organization has no managed Bedrock deployment.");
    this.name = "ManagedBedrockNotConfiguredError";
  }
}

export class ManagedProviderService implements ManagedProviderApi {
  private constructor(
    private readonly configuration: ManagedProviderConfiguration,
    private readonly credentials: ManagedProviderCredentialVendor,
  ) {}

  static create(options: {
    configuration: ManagedProviderConfiguration;
    credentials: ManagedProviderCredentialVendor;
  }): ManagedProviderService {
    return new ManagedProviderService(options.configuration, options.credentials);
  }

  isManagedProvider({
    organizationId,
    provider,
  }: {
    organizationId: string;
    provider: string;
  }): boolean {
    return (
      provider === "bedrock" &&
      this.configuration.getBedrockDeployment(organizationId).kind === "managed"
    );
  }

  async buildLitellmParameters(
    input: BuildManagedProviderParametersInput,
  ): Promise<Record<string, string>> {
    if (
      !this.isManagedProvider({
        organizationId: input.organizationId,
        provider: input.modelProvider.provider,
      })
    ) {
      return input.params;
    }

    const credentials = await this.getBedrockCredentials(input);
    input.params.aws_access_key_id = credentials.accessKeyId;
    input.params.aws_secret_access_key = credentials.secretAccessKey;
    input.params.aws_session_token = credentials.sessionToken;
    input.params.aws_region_name = credentials.region;
    input.params.aws_bedrock_runtime_endpoint = credentials.runtimeEndpoint;
    delete input.params.api_key;

    return input.params;
  }

  async getBedrockCredentials({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ManagedBedrockCredentials> {
    const deployment = this.configuration.getBedrockDeployment(organizationId);
    if (deployment.kind === "unmanaged") {
      throw new ManagedBedrockNotConfiguredError();
    }

    const { config } = deployment;
    const credentials = await this.credentials.assumeCustomerRole(config);
    return {
      ...credentials,
      region: config.region,
      runtimeEndpoint:
        config.bedrockProxyEndpoint.startsWith("http://") ||
        config.bedrockProxyEndpoint.startsWith("https://")
          ? config.bedrockProxyEndpoint
          : `http://${config.bedrockProxyEndpoint}`,
    };
  }
}
