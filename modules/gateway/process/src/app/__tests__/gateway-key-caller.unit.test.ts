import type { AuthzApi } from "@langwatch/authz-contract";
import type { VirtualKeyWithScopes } from "@langwatch/gateway-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ResourceScope } from "@langwatch/process";
import type { Encryption } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
/**
 * @vitest-environment node
 * `GatewayModule.authorizeKeyCaller`: any API key, including an organization key
 * that names no project, is authorized for organization-owned budget rows.
 * `GatewayModule.authorizeVirtualKeyCaller`: the same keys on the virtual key routes.
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

describe("GatewayModule.authorizeKeyCaller", () => {
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
    /** @scenario An organization key with no project lists the organization's budgets */
    it("checks the read at the organization and answers with the key's organization", async () => {
      const app = await gatewayApp();

      const authorized = await app.authorizeKeyCaller({
        caller: organizationKey,
        permission: "gatewayBudgets:view",
        reach: "caller",
      });

      expect(authorized.organizationId).toBe(ORGANIZATION_ID);
      expect(authorized.actorUserId).toBe("user_1");
      expect(hasApiKeyPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyId: "key_org",
          permission: "gatewayBudgets:view",
          scope: { type: "org", id: ORGANIZATION_ID },
        }),
      );
      expect(findOrganizationId).not.toHaveBeenCalled();
    });

    describe("when the key does not hold the permission", () => {
      /** @scenario A key without the budget permission is refused by permission, not as a bad key */
      it("refuses with permission_denied naming the permission", async () => {
        hasApiKeyPermission.mockResolvedValue(false);
        const app = await gatewayApp();

        const refusal = await app
          .authorizeKeyCaller({
            caller: organizationKey,
            permission: "gatewayBudgets:view",
            reach: "caller",
          })
          .catch((error: unknown) => error);

        expect(refusal).toMatchObject({
          code: "permission_denied",
          httpStatus: 403,
          meta: expect.objectContaining({ permission: "gatewayBudgets:view" }),
        });
      });
    });

    describe("when the service key acts as nobody", () => {
      it("records writes under a stable machine principal named after the key", async () => {
        const app = await gatewayApp();

        const authorized = await app.authorizeKeyCaller({
          caller: { ...organizationKey, userId: null },
          permission: "gatewayBudgets:create",
          reach: "organization",
        });

        expect(authorized.actorUserId).toBe("svc_key_org");
      });
    });
  });

  describe("given a key that resolved one project", () => {
    /** @scenario A project key keeps reading budgets at its own project */
    it("checks a read at that project", async () => {
      const app = await gatewayApp();

      await app.authorizeKeyCaller({
        caller: projectKey,
        permission: "gatewayBudgets:view",
        reach: "caller",
      });

      expect(hasApiKeyPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: { type: "project", id: PROJECT_ID, teamId: TEAM_ID },
        }),
      );
    });

    /** @scenario A budget write is checked at the organization whatever key calls it */
    it("checks a write at the organization", async () => {
      const app = await gatewayApp();

      await app.authorizeKeyCaller({
        caller: projectKey,
        permission: "gatewayBudgets:update",
        reach: "organization",
      });

      expect(hasApiKeyPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          permission: "gatewayBudgets:update",
          scope: { type: "org", id: ORGANIZATION_ID },
        }),
      );
    });
  });

  describe("given a legacy project key", () => {
    it("reads at its own project with no permission lookup", async () => {
      const app = await gatewayApp();

      const authorized = await app.authorizeKeyCaller({
        caller: { kind: "project", projectId: PROJECT_ID },
        permission: "gatewayBudgets:view",
        reach: "caller",
      });

      expect(authorized).toMatchObject({
        organizationId: ORGANIZATION_ID,
        actorUserId: `svc_${PROJECT_ID}`,
      });
      expect(hasApiKeyPermission).not.toHaveBeenCalled();
    });

    /** @scenario A legacy project key writes organization-wide budgets and cache rules */
    it("is admitted to an organization-wide write as its machine principal, asking no grant", async () => {
      const app = await gatewayApp();

      const authorized = await app.authorizeKeyCaller({
        caller: { kind: "project", projectId: PROJECT_ID },
        permission: "gatewayBudgets:create",
        reach: "organization",
      });

      expect(authorized).toMatchObject({
        organizationId: ORGANIZATION_ID,
        actorUserId: `svc_${PROJECT_ID}`,
      });
      expect(hasApiKeyPermission).not.toHaveBeenCalled();
    });
  });
});

/** A key row as far as visibility reads it: its id and the scopes it lives in. */
function keyScopedTo(id: string, ...scopes: VirtualKeyWithScopes["scopes"]): VirtualKeyWithScopes {
  return { id, scopes } as VirtualKeyWithScopes;
}

describe("GatewayModule.authorizeVirtualKeyCaller", () => {
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
    it("reaches its organization and asks no permission before a key is named", async () => {
      const app = await gatewayApp();

      const authorized = await app.authorizeVirtualKeyCaller({
        caller: organizationKey,
        permission: "virtualKeys:view",
      });

      expect(authorized).toMatchObject({
        organizationId: ORGANIZATION_ID,
        actorUserId: "user_1",
        projectId: null,
      });
      expect(hasApiKeyPermission).not.toHaveBeenCalled();
    });

    it("sees the keys it holds the view permission on, asking each scope once", async () => {
      hasApiKeyPermission.mockImplementation(async ({ scope }) => scope.id !== "team_other");
      const app = await gatewayApp();
      const authorized = await app.authorizeVirtualKeyCaller({
        caller: organizationKey,
        permission: "virtualKeys:view",
      });

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
    it("is asked the permission at that project and acts as its owning user", async () => {
      const app = await gatewayApp();

      const authorized = await app.authorizeVirtualKeyCaller({
        caller: projectKey,
        permission: "virtualKeys:create",
      });

      expect(authorized).toMatchObject({ actorUserId: "user_1", projectId: PROJECT_ID });
      expect(hasApiKeyPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyId: "key_project",
          permission: "virtualKeys:create",
          scope: { type: "project", id: PROJECT_ID, teamId: TEAM_ID },
        }),
      );
    });

    it("is refused by code when it does not hold the permission there", async () => {
      hasApiKeyPermission.mockResolvedValue(false);
      const app = await gatewayApp();

      await expect(
        app.authorizeVirtualKeyCaller({ caller: projectKey, permission: "virtualKeys:create" }),
      ).rejects.toMatchObject({ code: "permission_denied" });
    });

    /** @scenario A sibling team's keys are invisible to the project credential */
    it("sees organization keys, its team's and its own, never a sibling team's", async () => {
      const app = await gatewayApp();
      const authorized = await app.authorizeVirtualKeyCaller({
        caller: projectKey,
        permission: "virtualKeys:view",
      });

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

      const authorized = await app.authorizeVirtualKeyCaller({
        caller: { kind: "project", projectId: PROJECT_ID },
        permission: "virtualKeys:create",
      });

      expect(authorized).toMatchObject({
        organizationId: ORGANIZATION_ID,
        actorUserId: `svc_${PROJECT_ID}`,
        projectId: PROJECT_ID,
      });
      expect(hasApiKeyPermission).not.toHaveBeenCalled();
    });
  });

  describe("given a project-bound access token", () => {
    it("is asked the permission as its person, at the project it is bound to", async () => {
      const app = await gatewayApp();

      const authorized = await app.authorizeVirtualKeyCaller({
        caller: {
          kind: "cliAccessToken",
          userId: "user_9",
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          teamId: TEAM_ID,
        },
        permission: "virtualKeys:view",
      });

      expect(authorized).toMatchObject({ actorUserId: "user_9", projectId: PROJECT_ID });
      expect(hasPermission).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user_9", permission: "virtualKeys:view" }),
      );
      expect(hasApiKeyPermission).not.toHaveBeenCalled();
    });
  });
});
