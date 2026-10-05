import type { AuthzApi } from "@langwatch/authz-contract";
import type { VirtualKeyWithScopes } from "@langwatch/gateway-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ResourceScope } from "@langwatch/process";
import type { Encryption } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
/**
 * @vitest-environment node
 * `GatewayModule.getKeyCaller`: any API key the key door admitted, including an organization
 * key that names no project, as the organization it acts in and who a write is recorded as.
 * `GatewayModule.getVirtualKeyCaller`: the same on the virtual key routes, with its project.
 * @see specs/ai-gateway/per-team-budget-reorganization.feature
 * @see specs/ai-gateway/public-rest-api.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayModule } from "../gateway.app.ts";

function peer(name: string): never {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === "symbol") return undefined;
        throw new Error(`The ${name} peer was called for "${String(property)}".`);
      },
    },
  ) as never;
}

const ORGANIZATION_ID = "org_1";
const PROJECT_ID = "project_1";
const TEAM_ID = "team_1";

const hasApiKeyPermission = vi.fn<AuthzApi["hasApiKeyPermission"]>();
const hasPermission = vi.fn<AuthzApi["hasPermission"]>();
const findOrganizationId = vi.fn<ProjectApi["findOrganizationId"]>();
const findProject = vi.fn<ProjectApi["findIdentity"]>();

const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

async function gatewayApp(): Promise<GatewayModule> {
  return GatewayModule.create({
    dependencies: {
      webhooks: peer("webhooks"),
      entitlement: peer("entitlement"),
      authz: createApiFixture<AuthzApi>({ hasApiKeyPermission, hasPermission }),
      projects: createApiFixture<ProjectApi>({ findOrganizationId, findIdentity: findProject }),
      evaluators: peer("evaluators"),
      evaluations: peer("evaluations"),
      monitors: peer("monitors"),
      organizations: peer("organizations"),
      featureFlags: peer("featureFlags"),
      modelProviders: peer("modelProviders"),
      traces: peer("traces"),
      oneTimeReveals: peer("oneTimeReveals"),
      apiKeys: peer("apiKeys"),
    },
    members: {
      prisma: prismaDouble({}) as PrismaClient,
      clickhouse: clickHouseQueryClientDouble({
        query: async () => ({ rows: [] }),
        insert: async () => {},
      }),
      encryption: createApiFixture<Encryption>(),
      redis: memoryRedisDouble(),
    },
    config: {
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      baseUrl: undefined,
      publicUrl: undefined,
      isSaas: false,
      allowLoopbackVoiceProviders: false,
    },
    resources: new ResourceScope(),
    secrets: noSecrets,
  });
}

const organizationKey = {
  kind: "apiKey" as const,
  apiKeyId: "key_org",
  userId: "user_1",
  organizationId: ORGANIZATION_ID,
};

const projectKey = {
  ...organizationKey,
  apiKeyId: "key_project",
  resolvedProject: { id: PROJECT_ID, teamId: TEAM_ID },
};

function expectNoPermissionAsked(): void {
  expect(hasApiKeyPermission).not.toHaveBeenCalled();
  expect(hasPermission).not.toHaveBeenCalled();
}

describe("GatewayModule.getKeyCaller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasApiKeyPermission.mockResolvedValue(true);
    findOrganizationId.mockResolvedValue(ORGANIZATION_ID);
    findProject.mockResolvedValue({
      id: PROJECT_ID,
      name: "Project",
      slug: "project",
      teamId: TEAM_ID,
      organizationId: ORGANIZATION_ID,
      isPersonal: false,
      ownerUserId: null,
    });
  });

  describe("given an organization key that names no project", () => {
    it("answers with the key's organization and its owning user, asking no permission", async () => {
      const app = await gatewayApp();

      const authorized = await app.getKeyCaller({ caller: organizationKey });

      expect(authorized).toEqual({
        organizationId: ORGANIZATION_ID,
        actor: {
          kind: "apiKey",
          apiKeyId: "key_org",
          userId: "user_1",
          organizationId: ORGANIZATION_ID,
        },
        actorUserId: "user_1",
      });
      expect(findOrganizationId).not.toHaveBeenCalled();
      expectNoPermissionAsked();
    });

    describe("when the service key has no owning user", () => {
      it("records writes under a stable machine principal named after the key", async () => {
        const app = await gatewayApp();

        const authorized = await app.getKeyCaller({
          caller: { ...organizationKey, userId: null },
        });

        expect(authorized.actor).toMatchObject({ kind: "apiKey", userId: null });
        expect(authorized.actorUserId).toBe("svc_key_org");
        expectNoPermissionAsked();
      });
    });
  });

  describe("given a key that resolved one project", () => {
    it("answers with the key's organization and its owning user, asking no permission", async () => {
      const app = await gatewayApp();

      const authorized = await app.getKeyCaller({ caller: projectKey });

      expect(authorized).toEqual({
        organizationId: ORGANIZATION_ID,
        actor: {
          kind: "apiKey",
          apiKeyId: "key_project",
          userId: "user_1",
          organizationId: ORGANIZATION_ID,
        },
        actorUserId: "user_1",
      });
      expectNoPermissionAsked();
    });

    describe("when the service key has no owning user", () => {
      it("records writes under a machine principal named after its project", async () => {
        const app = await gatewayApp();

        const authorized = await app.getKeyCaller({ caller: { ...projectKey, userId: null } });

        expect(authorized.actorUserId).toBe(`svc_${PROJECT_ID}`);
      });
    });
  });

  describe("given a legacy project key", () => {
    /** @scenario A legacy project key writes organization-wide budgets and cache rules */
    it("is its project's organization and machine principal, asking no grant", async () => {
      const app = await gatewayApp();

      const authorized = await app.getKeyCaller({
        caller: { kind: "project", projectId: PROJECT_ID },
      });

      expect(authorized).toEqual({
        organizationId: ORGANIZATION_ID,
        actor: { kind: "legacyProjectKey", projectId: PROJECT_ID },
        actorUserId: `svc_${PROJECT_ID}`,
      });
      expectNoPermissionAsked();
    });
  });
});

/** A key row as far as visibility reads it: its id and the scopes it lives in. */
function keyScopedTo(id: string, ...scopes: VirtualKeyWithScopes["scopes"]): VirtualKeyWithScopes {
  return { id, scopes } as VirtualKeyWithScopes;
}

describe("GatewayModule.getVirtualKeyCaller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasApiKeyPermission.mockResolvedValue(true);
    hasPermission.mockResolvedValue(true);
    findOrganizationId.mockResolvedValue(ORGANIZATION_ID);
    findProject.mockResolvedValue({
      id: PROJECT_ID,
      name: "Project",
      slug: "project",
      teamId: TEAM_ID,
      organizationId: ORGANIZATION_ID,
      isPersonal: false,
      ownerUserId: null,
    });
  });

  describe("given an organization key that names no project", () => {
    it("reaches its organization with no project, asking no permission", async () => {
      const app = await gatewayApp();

      const authorized = await app.getVirtualKeyCaller({ caller: organizationKey });

      expect(authorized).toEqual({
        organizationId: ORGANIZATION_ID,
        projectId: null,
        actor: {
          kind: "apiKey",
          apiKeyId: "key_org",
          userId: "user_1",
          organizationId: ORGANIZATION_ID,
        },
        actorUserId: "user_1",
      });
      expectNoPermissionAsked();
    });

    it("sees the keys it holds the view permission on, asking each scope once", async () => {
      hasApiKeyPermission.mockImplementation(async ({ scope }) => scope.id !== "team_other");
      const app = await gatewayApp();
      const authorized = await app.getVirtualKeyCaller({ caller: organizationKey });

      const visible = await app.visibleToVirtualKeyCaller({
        caller: authorized,
        virtualKeys: [
          keyScopedTo("vk_org", { scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID }),
          keyScopedTo("vk_team", { scopeType: "TEAM", scopeId: TEAM_ID }),
          keyScopedTo("vk_team_twin", { scopeType: "TEAM", scopeId: TEAM_ID }),
          keyScopedTo("vk_other", { scopeType: "TEAM", scopeId: "team_other" }),
        ],
      });

      expect(visible.map((key) => key.id)).toEqual(["vk_org", "vk_team", "vk_team_twin"]);
      expect(hasApiKeyPermission).toHaveBeenCalledTimes(3);
      expect(hasApiKeyPermission).toHaveBeenCalledWith(
        expect.objectContaining({ apiKeyId: "key_org", permission: "virtualKeys:view" }),
      );
    });
  });

  describe("given an API key that names a project", () => {
    /** @scenario Writes from a scoped API key are attributed to its user */
    it("acts in that project as its owning user, asking no permission", async () => {
      const app = await gatewayApp();

      const authorized = await app.getVirtualKeyCaller({ caller: projectKey });

      expect(authorized).toEqual({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        actor: {
          kind: "apiKey",
          apiKeyId: "key_project",
          userId: "user_1",
          organizationId: ORGANIZATION_ID,
        },
        actorUserId: "user_1",
      });
      expectNoPermissionAsked();
    });

    /** @scenario A sibling team's keys are invisible to the project credential */
    it("sees organization keys, its team's and its own, never a sibling team's", async () => {
      const app = await gatewayApp();
      const authorized = await app.getVirtualKeyCaller({ caller: projectKey });

      const visible = await app.visibleToVirtualKeyCaller({
        caller: authorized,
        virtualKeys: [
          keyScopedTo("vk_org", { scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID }),
          keyScopedTo("vk_team", { scopeType: "TEAM", scopeId: TEAM_ID }),
          keyScopedTo("vk_own", { scopeType: "PROJECT", scopeId: PROJECT_ID }),
          keyScopedTo("vk_sibling", { scopeType: "PROJECT", scopeId: "project_sibling" }),
          keyScopedTo("vk_other_team", { scopeType: "TEAM", scopeId: "team_other" }),
        ],
      });

      expect(visible.map((key) => key.id)).toEqual(["vk_org", "vk_team", "vk_own"]);
    });
  });

  describe("given a legacy project key", () => {
    /** @scenario Writes from a legacy project key are attributed to the machine principal */
    it("acts in its own project as the machine principal, asking no grant", async () => {
      const app = await gatewayApp();

      const authorized = await app.getVirtualKeyCaller({
        caller: { kind: "project", projectId: PROJECT_ID },
      });

      expect(authorized).toEqual({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        actor: { kind: "legacyProjectKey", projectId: PROJECT_ID },
        actorUserId: `svc_${PROJECT_ID}`,
      });
      expectNoPermissionAsked();
    });
  });

  describe("given a project-bound access token", () => {
    it("acts as its person in the project it is bound to, asking no permission", async () => {
      const app = await gatewayApp();

      const authorized = await app.getVirtualKeyCaller({
        caller: {
          kind: "cliAccessToken",
          userId: "user_9",
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          teamId: TEAM_ID,
        },
      });

      expect(authorized).toEqual({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        actor: { kind: "cliAccessToken", userId: "user_9", projectId: PROJECT_ID },
        actorUserId: "user_9",
      });
      expect(findOrganizationId).not.toHaveBeenCalled();
      expectNoPermissionAsked();
    });
  });
});
