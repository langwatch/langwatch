import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import type {
  EnterpriseGatewayApi,
  PersonalVirtualKey,
  RoutingPolicy,
} from "@langwatch/enterprise-gateway-contract";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type { EmailDelivery } from "@langwatch/mail";
import type {
  OrganizationApi,
  OrganizationSettings,
  PersonalWorkspace,
} from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { UserApi } from "@langwatch/user-contract";
import { hash } from "bcrypt";
import { describe, expect, it, vi } from "vitest";

import { userServer } from "../../user.server.ts";
import {
  createUserTestAuth,
  createUserTestOps,
  createUserTestOrganizations,
} from "./user.fixture.ts";

/**
 * The narrow slice of a generated Prisma client the organization directory
 * reads, faked so the installation test can boot `UserApp` without a real
 * database; every read here answers "not found".
 */
function fakeUserPrisma(): PrismaClient {
  return prismaDouble({
    organizationUser: { findFirst: async () => null },
    organization: { findUnique: async () => null },
    project: { findFirst: async () => null },
  });
}

/** The fixed-window counter's own three calls, faked to always allow. */
function fakeUserRedis(): RedisConnection {
  return redisDouble({ incr: async () => 1, expire: async () => 1, ttl: async () => -1 });
}

function process(
  role: "api" | "worker",
  peers: Readonly<{
    authz?: AuthzApi;
    enterpriseGateway?: EnterpriseGatewayApi;
    gateway?: GatewayApi;
    organization?: OrganizationApi;
  }> = {},
) {
  return createApp({ role })
    .withModules([withMemoryRepositories(userServer)])
    .withMembers({
      passkeysEnabled: false,
      publicBaseUrl: undefined,
      mail: createApiFixture<EmailDelivery>(),
    })
    .withRelational(fakeUserPrisma())
    .withKeyvalue(fakeUserRedis())
    .provide({
      auth: createUserTestAuth(),
      authz: peers.authz ?? createApiFixture<AuthzApi>(),
      "enterprise-gateway": peers.enterpriseGateway ?? createApiFixture<EnterpriseGatewayApi>(),
      gateway: peers.gateway ?? createApiFixture<GatewayApi>(),
      governance: createApiFixture<GovernanceRestApi>(),
      organization: peers.organization ?? createUserTestOrganizations(),
      ops: createUserTestOps(),
      project: createApiFixture<ProjectApi>(),
      "stored-object": createApiFixture<StoredObjectApi>(),
    });
}

describe("user app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

    try {
      const app = runtime.service(UserApi);
      expect(runtime.module(userServer).provided).toBe(app);

      const created = await app.createCredentialUser({
        name: "Ada",
        email: "ada@example.com",
        passwordHash: "hashed:first",
      });

      await expect(app.findById({ id: created.id })).resolves.toMatchObject({
        email: "ada@example.com",
      });
      await expect(app.hasPassword({ id: created.id })).resolves.toBe(true);
    } finally {
      await runtime.stop();
    }
  });

  it("rotates a password through the credential repository the installer selected", async () => {
    const runtime = await process("api").boot();

    try {
      const app = runtime.service(UserApi);
      // The real bcrypt hasher this app builds from its own reads, not a
      // fake one: a rotation must verify against the SAME stored format the
      // credential row was minted with.
      const created = await app.createCredentialUser({
        name: "Ada",
        email: "ada@example.com",
        passwordHash: await hash("first", 10),
      });

      await expect(
        app.rotatePassword({
          userId: created.id,
          currentPassword: "first",
          newPassword: "second",
        }),
      ).resolves.toBe("rotated");
      await expect(
        app.rotatePassword({
          userId: created.id,
          currentPassword: "first",
          newPassword: "third",
        }),
      ).resolves.toBe("wrong_password");
    } finally {
      await runtime.stop();
    }
  });

  it("allocates independent memory repositories for each installation", async () => {
    const first = await process("api").boot();
    const second = await process("api").boot();

    try {
      const created = await first.service(UserApi).createCredentialUser({
        name: "Ada",
        email: "ada@example.com",
        passwordHash: "hashed:first",
      });

      await expect(second.service(UserApi).findById({ id: created.id })).resolves.toBeNull();
    } finally {
      await first.stop();
      await second.stop();
    }
  });
});

describe("the /me gateway reads", () => {
  const workspace: PersonalWorkspace = {
    team: { id: "team-1", name: "Ada's workspace", slug: "ada", createdAtMs: 0 },
    project: { id: "project-1", name: "Ada", slug: "ada", apiKey: "sk-lw-1", createdAtMs: 0 },
  };
  const organization = Object.assign(createUserTestOrganizations(), {
    getPersonalWorkspace: vi.fn(async () => workspace),
    getSettings: vi.fn(async (): Promise<OrganizationSettings> => ({
      id: "org-1",
      name: "Acme",
      slug: "acme",
      supportContact: "it@example.com",
      presenceEnabled: false,
      traceSharingEnabled: false,
      primaryIntent: null,
      s3Endpoint: null,
      s3AccessKeyId: null,
      s3Bucket: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
  });

  /** @scenario "The personal context names the default routing policy the gateway resolves" */
  it("names the first default routing policy enterprise gateway answers", async () => {
    const findDefaultRoutingPolicies = vi.fn(async () => [
      routingPolicy({ id: "policy-team", name: "Team default" }),
      routingPolicy({ id: "policy-org", name: "Org default" }),
    ]);
    const runtime = await process("api", {
      authz: createApiFixture<AuthzApi>({ hasPermission: async () => true }),
      enterpriseGateway: createApiFixture<EnterpriseGatewayApi>({ findDefaultRoutingPolicies }),
      organization,
    }).boot();

    try {
      const context = await runtime
        .service(UserApi)
        .getPersonalContext({ userId: "user-1", organizationId: "org-1" });

      expect(context.routingPolicy).toEqual({ id: "policy-team", name: "Team default" });
      expect(findDefaultRoutingPolicies).toHaveBeenCalledWith({
        organizationId: "org-1",
        personalTeamId: "team-1",
      });
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The personal budget warns at the gateway's soft warning on the caller's own key" */
  it("checks the caller's own key with the gateway and answers a warning", async () => {
    const checkBudget = vi.fn(async () => ({
      decision: "soft_warn" as const,
      warnings: [],
      blockReason: null,
      blockedBy: [],
      scopes: [
        { scope: "PRINCIPAL", scopeId: "user-1", window: "MONTH", spentUsd: "85", limitUsd: "100" },
      ],
    }));
    const personalVirtualKeyList = vi.fn(async () => [personalKey({ id: "vk-1" })]);
    const runtime = await process("api", {
      enterpriseGateway: createApiFixture<EnterpriseGatewayApi>({ personalVirtualKeyList }),
      gateway: createApiFixture<GatewayApi>({ checkBudget }),
      organization,
    }).boot();

    try {
      const budget = await runtime
        .service(UserApi)
        .getPersonalBudget({ userId: "user-1", organizationId: "org-1" });

      expect(budget).toMatchObject({ status: "warning", spentUsd: "85", limitUsd: "100" });
      expect(personalVirtualKeyList).toHaveBeenCalledWith({
        userId: "user-1",
        organizationId: "org-1",
      });
      expect(checkBudget).toHaveBeenCalledWith({
        organizationId: "org-1",
        teamId: "team-1",
        projectId: "project-1",
        virtualKeyId: "vk-1",
        principalUserId: "user-1",
        projectedCostUsd: 0,
      });
    } finally {
      await runtime.stop();
    }
  });
});

function routingPolicy({ id, name }: { id: string; name: string }): RoutingPolicy {
  return {
    id,
    organizationId: "org-1",
    name,
    description: null,
    modelProviderIds: [],
    modelAliases: {},
    defaultModel: null,
    policyRules: {},
    isDefault: true,
    createdAtMs: 0,
    updatedAtMs: 0,
    createdById: null,
    updatedById: null,
    scopes: [],
  };
}

function personalKey({ id }: { id: string }): PersonalVirtualKey {
  return {
    id,
    organizationId: "org-1",
    name: "Ada's key",
    description: null,
    displayPrefix: "lw_vk_",
    status: "ACTIVE",
    principalUserId: "user-1",
    routingPolicyId: null,
    createdAtMs: 0,
    updatedAtMs: 0,
    lastUsedAtMs: null,
    scopes: [],
  };
}
