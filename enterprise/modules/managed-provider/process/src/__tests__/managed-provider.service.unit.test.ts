import type { ManagedBedrockConfig } from "@langwatch/enterprise-managed-provider-contract";
import { describe, expect, it } from "vitest";

import {
  ManagedProviderConfigurationService,
  ManagedProviderCredentialVendor,
  ManagedProviderService,
  type ManagedProviderCredentials,
} from "../index.ts";
import { TestProjectApi } from "./test-project-api.ts";

class Projects extends TestProjectApi {
  override async findOrganizationId(): Promise<string> {
    return "org_1";
  }

  override async listPaths(): Promise<never[]> {
    return [];
  }
}

class CredentialVendorTestDouble extends ManagedProviderCredentialVendor {
  configs: ManagedBedrockConfig[] = [];
  async assumeCustomerRole(config: ManagedBedrockConfig): Promise<ManagedProviderCredentials> {
    this.configs.push(config);
    return {
      accessKeyId: "temporary-key",
      secretAccessKey: "temporary-secret",
      sessionToken: "temporary-token",
    };
  }
}

const CONFIGURED_ORGANIZATION_DIRECTORY = {
  org_1: {
    proxyRoleArn: "proxy",
    bedrockRoleArn: "customer",
    proxyAwsAccessKeyId: "key",
    proxyAwsSecretAccessKey: "secret",
    bedrockProxyEndpoint: "private.internal",
    region: "eu-west-1",
  },
};

function configurationForConfiguredOrganization(): ManagedProviderConfigurationService {
  return ManagedProviderConfigurationService.create({ bedrock: CONFIGURED_ORGANIZATION_DIRECTORY });
}

describe("ManagedProviderService", () => {
  describe("given an organization with an injected Bedrock configuration", () => {
    describe("when the service is asked which providers it manages", () => {
      /** @scenario "Resolve a managed Bedrock provider" */
      it("reports bedrock as managed and every other provider as unmanaged", () => {
        const service = ManagedProviderService.create({
          configuration: configurationForConfiguredOrganization(),
          projects: new Projects(),
          credentials: new CredentialVendorTestDouble(),
        });

        expect(service.isManagedProvider({ organizationId: "org_1", provider: "bedrock" })).toBe(
          true,
        );
        expect(service.isManagedProvider({ organizationId: "org_1", provider: "openai" })).toBe(
          false,
        );
        expect(service.isManagedProvider({ organizationId: "org_2", provider: "bedrock" })).toBe(
          false,
        );
      });
    });
  });

  describe("given a model provider that is not Bedrock", () => {
    describe("when LiteLLM parameters are prepared", () => {
      /** @scenario "Ignore unrelated providers" */
      it("returns the caller's parameters untouched and assumes no role", async () => {
        const credentials = new CredentialVendorTestDouble();
        const service = ManagedProviderService.create({
          configuration: configurationForConfiguredOrganization(),
          projects: new Projects(),
          credentials,
        });
        const params = { api_key: "caller-key", model: "gpt-5-mini" };

        const result = await service.buildLitellmParameters({
          params,
          projectId: "project-1",
          model: "gpt-5-mini",
          modelProvider: { provider: "openai" },
        });

        expect(result).toBe(params);
        expect(result).toEqual({ api_key: "caller-key", model: "gpt-5-mini" });
        expect(credentials.configs).toEqual([]);
      });
    });
  });

  /** @scenario "Build credentials through both roles" */
  it("replaces an API key with chained Bedrock credentials", async () => {
    const configuration = configurationForConfiguredOrganization();
    const service = ManagedProviderService.create({
      configuration,
      projects: new Projects(),
      credentials: new CredentialVendorTestDouble(),
    });
    const result = await service.buildLitellmParameters({
      params: { api_key: "old" },
      projectId: "project-1",
      model: "model",
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
