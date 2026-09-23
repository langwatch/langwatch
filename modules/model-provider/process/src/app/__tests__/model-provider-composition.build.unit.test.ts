import { createApiFixture } from "@langwatch/api-fixture";
/**
 * Tests that ModelProviderApp.create builds collaborators from declared members and config,
 * not from hand-composed infrastructure. Regression: before regaining build step, calls
 * crashed on undefined errors (defaultFeatures, systemProviders, exists).
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { projectWithTeamSchema, type ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { MemoryModelProviderRepositories } from "../../repositories/memory/memory.model-provider.repositories.ts";
import { ModelProviderApp } from "../model-provider.app.ts";
import { createModelProviderTestDataPrivacy } from "./model-provider.fixture.ts";

function testProject(id: string) {
  return projectWithTeamSchema.parse({
    id,
    name: "Test Project",
    slug: "test-project",
    apiKey: "test-api-key",
    lwqlKey: "test-lwql-key",
    teamId: "team-1",
    language: "typescript",
    framework: "langchain",
    kind: "application",
    firstMessage: false,
    integrated: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    team: {
      id: "team-1",
      name: "Test Team",
      slug: "test-team",
      organizationId: "organization-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      archivedAt: null,
      isPersonal: false,
      ownerUserId: null,
      departmentId: null,
    },
  });
}

/** A project read fuller than the shared fixture's: this suite also drives the scope derivation. */
function createFullModelProviderTestProjects(): ProjectApi {
  return createApiFixture<ProjectApi>({
    getWithTeam: async (id: string) => testProject(id),
    findWithTeam: async (id: string) => testProject(id),
    listIdsByOrganization: async () => [],
    listNamesByIds: async () => [],
  });
}

/** An organization read fuller than the shared fixture's, for the same reason. */
function createFullModelProviderTestOrganizations(): OrganizationApi {
  return createApiFixture<OrganizationApi>({
    getBillingProfile: async ({ organizationId }: { organizationId: string }) => ({
      id: organizationId,
      name: "Test Organization",
      billingCustomerId: null,
    }),
    listTeams: async () => ({
      data: [],
      pagination: { total: 0, page: 1, limit: 1_000 },
    }),
  });
}

/**
 * The `redis` member, faked to the three calls this module's connection
 * counter makes — not a full `RedisConnection`, since nothing here reaches
 * `testConnection`. Same "narrow double" idiom as `modules/agent`'s.
 */
function fakeRedis(): RedisConnection {
  return {
    incr: async () => 1,
    expire: async () => 1,
    ttl: async () => 0,
  } as unknown as RedisConnection;
}

/**
 * Builds the app exactly the way boot does: through `create`, not test-only
 * `createForTesting`.
 */
function createRealModelProviderApp(): Promise<ModelProviderApp> {
  return ModelProviderApp.create({
    repositories: MemoryModelProviderRepositories.create(),
    dependencies: {
      projects: createFullModelProviderTestProjects(),
      organizations: createFullModelProviderTestOrganizations(),
      permissions: createApiFixture<AuthzApi>({ hasProjectPermission: async () => true }),
      dataPrivacy: createModelProviderTestDataPrivacy(),
    },
    members: {
      redis: fakeRedis(),
      nlpServiceUrl: undefined,
    },
    config: {
      blockLocalHttpCalls: true,
      allowedProxyHosts: [],
      defaultModel: undefined,
    },
    resources: new ResourceScope(),
    secrets: SecretsResolver.over(SecretsChain.start({ environment: {} })).scopeTo(
      "model-provider",
      Object.values(ModelProviderApp.secrets),
    ),
  });
}

describe("ModelProviderApp.create", () => {
  describe("given only the process's own redis and secrets members", () => {
    it("answers the default-models feature catalogue instead of crashing on undefined defaultFeatures", async () => {
      const app = await createRealModelProviderApp();

      await expect(
        app.getDefaultSnapshotUnattributed({ projectId: "project-1" }),
      ).resolves.toBeDefined();
    });

    it("answers the provider list instead of crashing on undefined systemProviders", async () => {
      const app = await createRealModelProviderApp();

      await expect(app.listForProject({ projectId: "project-1" })).resolves.toEqual([]);
    });

    it("recognizes a known provider instead of crashing on undefined exists", async () => {
      const app = await createRealModelProviderApp();

      await expect(
        app.upsertUnattributed({
          projectId: "project-1",
          provider: "openai",
          enabled: true,
          customKeys: { OPENAI_API_KEY: "sk-test" },
        }),
      ).resolves.toBeDefined();
    });
  });
});
