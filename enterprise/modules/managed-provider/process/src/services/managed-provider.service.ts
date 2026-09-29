import {
  type BuildManagedProviderParametersInput,
  type ManagedProviderApi,
} from "@langwatch/enterprise-managed-provider-contract";

import type { ManagedProviderCredentialVendor } from "../channels/managed-provider-credentials.channel.ts";
import type { ManagedProviderConfiguration } from "./managed-provider-configuration.service.ts";

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
    if (input.modelProvider.provider !== "bedrock") {
      return input.params;
    }

    const deployment = this.configuration.getBedrockDeployment(input.organizationId);

    if (deployment.kind === "unmanaged") {
      return input.params;
    }

    const { config } = deployment;

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
}
