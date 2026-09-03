import type { ManagedBedrockConfig } from "@langwatch/enterprise-managed-provider-contract";
import { describe, expect, it } from "vitest";
import {
  EnvironmentManagedProviderConfigurationAdapter,
  ManagedProviderCredentialsPort,
  ManagedProviderService,
  type ManagedProviderCredentials,
  ManagedProviderConfigurationReporter,
} from "../index";
import { ProjectService } from "@langwatch/project-contract";

class SilentReporter extends ManagedProviderConfigurationReporter {
  info(): void {}
  warn(): void {}
}

class Projects extends ProjectService {
  tryFindInternal(): never {
    throw new Error("Not used by this test");
  }

  ensureInternal(): never {
    throw new Error("Not used by this test");
  }

  isPresenceEnabled(): never {
    throw new Error("Not used by this test");
  }

  getById(): never {
    throw new Error("Not used by this test");
  }

  getOrganizationId(): never {
    throw new Error("Not used by this test");
  }

  async tryGetOrganizationId(): Promise<string> {
    return "org_1";
  }

  tryGetIdentity(): never {
    throw new Error("Not used by this test");
  }
  tryGetById(): never {
    throw new Error("Not used by this test");
  }
  tryGetSummaryById(): never {
    throw new Error("Not used by this test");
  }
  getWithTeam(): never {
    throw new Error("Not used by this test");
  }
  tryGetWithTeam(): never {
    throw new Error("Not used by this test");
  }
  create(): never {
    throw new Error("Not used by this test");
  }
  update(): never {
    throw new Error("Not used by this test");
  }
  archive(): never {
    throw new Error("Not used by this test");
  }
  listByOrganization(): never {
    throw new Error("Not used by this test");
  }
  listByTeam(): never {
    throw new Error("Not used by this test");
  }
  listNamesByIds(): never {
    throw new Error("Not used by this test");
  }
  listIdsByOrganization(): never {
    throw new Error("Not used by this test");
  }
  listActiveByScopes(): never {
    throw new Error("Not used by this test");
  }
  updateMetadata(): never {
    throw new Error("Not used by this test");
  }
  touchCodingAgentSessionSeen(): never {
    throw new Error("Not used by this test");
  }
  touchCodingAgentPullRequestSeen(): never {
    throw new Error("Not used by this test");
  }
  searchByQuery(): never {
    throw new Error("Not used by this test");
  }
  tryGetTraceSharingConfig(): never {
    throw new Error("Not used by this test");
  }
  resolveOrgAdmin(): never {
    throw new Error("Not used by this test");
  }
  resolveTraceDestination(): never {
    throw new Error("Not used by this test");
  }
  tryGetTraceDestination(): never {
    throw new Error("Not used by this test");
  }
  listTraceDestinations(): never {
    throw new Error("Not used by this test");
  }
}

class CredentialAdapter extends ManagedProviderCredentialsPort {
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

const CONFIGURED_ORGANIZATION_SOURCE = {
  MANAGED_BEDROCK__customer__org_1: JSON.stringify({
    proxyRoleArn: "proxy",
    bedrockRoleArn: "customer",
    proxyAwsAccessKeyId: "key",
    proxyAwsSecretAccessKey: "secret",
    bedrockProxyEndpoint: "private.internal",
    region: "eu-west-1",
  }),
};

function configurationForConfiguredOrganization(): EnvironmentManagedProviderConfigurationAdapter {
  return EnvironmentManagedProviderConfigurationAdapter.create({
    source: CONFIGURED_ORGANIZATION_SOURCE,
    reporter: new SilentReporter(),
  });
}

describe("ManagedProviderService", () => {
  describe("given an organization with an injected Bedrock configuration", () => {
    describe("when the service is asked which providers it manages", () => {
      /** @scenario "Resolve a managed Bedrock provider" */
      it("reports bedrock as managed and every other provider as unmanaged", () => {
        const service = ManagedProviderService.create({
          configuration: configurationForConfiguredOrganization(),
          projects: new Projects(),
          credentials: new CredentialAdapter(),
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
        const credentials = new CredentialAdapter();
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
    const configuration = EnvironmentManagedProviderConfigurationAdapter.create({
      source: {
        MANAGED_BEDROCK__customer__org_1: JSON.stringify({
          proxyRoleArn: "proxy",
          bedrockRoleArn: "customer",
          proxyAwsAccessKeyId: "key",
          proxyAwsSecretAccessKey: "secret",
          bedrockProxyEndpoint: "private.internal",
          region: "eu-west-1",
        }),
      },
      reporter: new SilentReporter(),
    });
    const service = ManagedProviderService.create({
      configuration,
      projects: new Projects(),
      credentials: new CredentialAdapter(),
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
