import { describe, expect, it } from "vitest";
import type { ManagedBedrockConfig } from "@langwatch/enterprise-managed-provider-contract";
import {
  ManagedProviderConfigurationPort,
  ManagedProviderCredentialsPort,
  type ManagedProviderCredentials,
} from "@langwatch/enterprise-managed-provider-server";
import { ProjectService } from "@langwatch/project-contract";
import { EnterpriseWorkerComposition } from "../src";

describe("EnterpriseWorkerComposition", () => {
  it("creates a worker-only shell over the portable catalogue", () => {
    const composition = EnterpriseWorkerComposition.create();

    expect(composition.catalogue.get("licensing")).toBeDefined();
    expect(composition.managedProviders).toBeUndefined();
  });

  /** @scenario "Create the worker composition with explicit feature ports" */
  it("creates a worker-only composition over the portable catalogue", () => {
    const composition = EnterpriseWorkerComposition.create({
      managedProvider: {
        projects: TestProjects.create(),
        configuration: TestConfiguration.create(),
        credentials: TestCredentials.create(),
      },
    });

    expect(composition.catalogue.get("licensing")).toBeDefined();
    expect(
      composition.managedProviders.isManagedProvider({
        organizationId: "org-1",
        provider: "bedrock",
      }),
    ).toBe(true);
  });

  /** @scenario "Managed provider execution uses the composed worker capability" */
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

class TestProjects extends ProjectService {
  static create(): TestProjects {
    return new TestProjects();
  }

  tryFindInternal = unavailable<ProjectService["tryFindInternal"]>();
  ensureInternal = unavailable<ProjectService["ensureInternal"]>();
  isPresenceEnabled = unavailable<ProjectService["isPresenceEnabled"]>();
  getById = unavailable<ProjectService["getById"]>();
  getOrganizationId = unavailable<ProjectService["getOrganizationId"]>();
  tryGetOrganizationId = async (projectId: string): Promise<string | undefined> =>
    projectId === "project-1" ? "org-1" : undefined;
  tryGetIdentity = unavailable<ProjectService["tryGetIdentity"]>();
  tryGetById = unavailable<ProjectService["tryGetById"]>();
  tryGetSummaryById = unavailable<ProjectService["tryGetSummaryById"]>();
  getWithTeam = unavailable<ProjectService["getWithTeam"]>();
  tryGetWithTeam = unavailable<ProjectService["tryGetWithTeam"]>();
  create = unavailable<ProjectService["create"]>();
  update = unavailable<ProjectService["update"]>();
  archive = unavailable<ProjectService["archive"]>();
  listByOrganization = unavailable<ProjectService["listByOrganization"]>();
  listByTeam = unavailable<ProjectService["listByTeam"]>();
  listNamesByIds = unavailable<ProjectService["listNamesByIds"]>();
  listIdsByOrganization = unavailable<ProjectService["listIdsByOrganization"]>();
  listActiveByScopes = unavailable<ProjectService["listActiveByScopes"]>();
  updateMetadata = unavailable<ProjectService["updateMetadata"]>();
  touchCodingAgentSessionSeen = unavailable<ProjectService["touchCodingAgentSessionSeen"]>();
  touchCodingAgentPullRequestSeen =
    unavailable<ProjectService["touchCodingAgentPullRequestSeen"]>();
  searchByQuery = unavailable<ProjectService["searchByQuery"]>();
  tryGetTraceSharingConfig = unavailable<ProjectService["tryGetTraceSharingConfig"]>();
  resolveOrgAdmin = unavailable<ProjectService["resolveOrgAdmin"]>();
  resolveTraceDestination = unavailable<ProjectService["resolveTraceDestination"]>();
  tryGetTraceDestination = unavailable<ProjectService["tryGetTraceDestination"]>();
  listTraceDestinations = unavailable<ProjectService["listTraceDestinations"]>();
}

function unavailable<Method>(): Method {
  return (() => Promise.reject(new Error("Not used by this test"))) as Method;
}
