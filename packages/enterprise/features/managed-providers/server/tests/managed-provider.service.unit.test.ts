import type { ManagedBedrockConfig } from "@langwatch/enterprise-managed-providers-contract";
import { describe, expect, it } from "vitest";
import {
  EnvironmentManagedProviderConfigurationAdapter,
  ManagedProviderCredentialsPort,
  ManagedProviderProjectRepository,
  ManagedProviderService,
  type ManagedProviderCredentials,
  ManagedProviderConfigurationReporter,
} from "../src";

class SilentReporter extends ManagedProviderConfigurationReporter {
  info(): void {}
  warn(): void {}
}

class ProjectRepository extends ManagedProviderProjectRepository {
  async getOrganizationId(): Promise<string> {
    return "org_1";
  }
}

class CredentialAdapter extends ManagedProviderCredentialsPort {
  configs: ManagedBedrockConfig[] = [];
  async assumeCustomerRole(config: ManagedBedrockConfig): Promise<ManagedProviderCredentials> {
    this.configs.push(config);
    return { accessKeyId: "temporary-key", secretAccessKey: "temporary-secret", sessionToken: "temporary-token" };
  }
}

describe("ManagedProviderService", () => {
  it("replaces an API key with chained Bedrock credentials", async () => {
    const configuration = EnvironmentManagedProviderConfigurationAdapter.create({
      source: {
        MANAGED_BEDROCK__customer__org_1: JSON.stringify({
          proxyRoleArn: "proxy", bedrockRoleArn: "customer",
          proxyAwsAccessKeyId: "key", proxyAwsSecretAccessKey: "secret",
          bedrockProxyEndpoint: "private.internal", region: "eu-west-1",
        }),
      },
      reporter: new SilentReporter(),
    });
    const service = ManagedProviderService.create({
      configuration,
      projects: new ProjectRepository(),
      credentials: new CredentialAdapter(),
    });
    const result = await service.buildLitellmParameters({
      params: { api_key: "old" }, projectId: "project-1", model: "model",
      modelProvider: { provider: "bedrock" },
    });
    expect(result).toMatchObject({
      aws_access_key_id: "temporary-key",
      aws_region_name: "eu-west-1",
      aws_bedrock_runtime_endpoint: "http://private.internal",
    });
    expect(result).not.toHaveProperty("api_key");
  });
});
