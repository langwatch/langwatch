import { describe, expect, it } from "vitest";
import type { ManagedBedrockConfig } from "@langwatch/enterprise-managed-provider-contract";
import {
  ManagedProviderConfigurationPort,
  ManagedProviderCredentialsPort,
  ManagedProviderProjectRepository,
  type ManagedProviderCredentials,
} from "@langwatch/enterprise-managed-provider-server";
import { EnterpriseWorkerComposition } from "../src";

describe("EnterpriseWorkerComposition", () => {
  it("creates a worker-only shell over the portable catalogue", () => {
    const composition = EnterpriseWorkerComposition.create();

    expect(composition.catalogue.get("licensing")).toBeDefined();
    expect(composition.managedProviders).toBeUndefined();
  });

  it("creates a worker-only composition over the portable catalogue", () => {
    const composition = EnterpriseWorkerComposition.create({
      managedProvider: {
        projects: TestProjects.create(),
        configuration: TestConfiguration.create(),
        credentials: TestCredentials.create(),
      },
    });

    expect(composition.catalogue.get("licensing")).toBeDefined();
    expect(composition.managedProviders.isManagedProvider("org-1", "bedrock")).toBe(true);
  });

  it("passes worker-owned project persistence through to managed provider execution", async () => {
    const composition = EnterpriseWorkerComposition.create({
      managedProvider: {
        projects: TestProjects.create(),
        configuration: TestConfiguration.create(),
        credentials: TestCredentials.create(),
      },
    });

    const parameters = await composition.managedProviders.buildLitellmParameters({
      params: { api_key: "customer-api-key" },
      projectId: "project-1",
      model: "anthropic.claude-3-sonnet",
      modelProvider: { provider: "bedrock" },
    });

    expect(parameters).toEqual({
      aws_access_key_id: "access-key",
      aws_secret_access_key: "secret-key",
      aws_session_token: "session-token",
      aws_region_name: "us-east-1",
      aws_bedrock_runtime_endpoint: "https://bedrock.example.com",
    });
  });
});

class TestConfiguration extends ManagedProviderConfigurationPort {
  static create(): TestConfiguration {
    return new TestConfiguration();
  }

  tryForOrganization(organizationId: string): ManagedBedrockConfig | null {
    if (organizationId !== "org-1") return null;
    return {
      proxyRoleArn: "arn:aws:iam::123456789012:role/proxy",
      bedrockRoleArn: "arn:aws:iam::123456789012:role/bedrock",
      proxyAwsAccessKeyId: "proxy-access-key",
      proxyAwsSecretAccessKey: "proxy-secret-key",
      bedrockProxyEndpoint: "https://bedrock.example.com",
      region: "us-east-1",
    };
  }
}

class TestCredentials extends ManagedProviderCredentialsPort {
  static create(): TestCredentials {
    return new TestCredentials();
  }

  async assumeCustomerRole(_config: ManagedBedrockConfig): Promise<ManagedProviderCredentials> {
    return {
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      sessionToken: "session-token",
    };
  }
}

class TestProjects extends ManagedProviderProjectRepository {
  static create(): TestProjects {
    return new TestProjects();
  }

  async tryGetOrganizationId(projectId: string): Promise<string | null> {
    return projectId === "project-1" ? "org-1" : null;
  }
}
