import type { AuthzAccessBinding, AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/api-fixture";
import type { UserApi } from "@langwatch/user-contract";

import { MemoryRoleRepository } from "../../repositories/memory/memory.role.repository.ts";
import { RoleApp } from "../role.app.ts";

/** A valid plan literal. ENTERPRISE by default, so custom-role writes are allowed
 * unless a test names another type. */
export function testPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planSource: "subscription",
    type: "ENTERPRISE",
    name: "Enterprise",
    free: false,
    maxMembers: 1,
    maxMembersLite: 1,
    maxMessagesPerMonth: 1,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
    ...overrides,
  };
}

/** Answers "not personal" for every team and project lookup: the scope fence
 * has its own suite in the owning feature. */
export function testRolePrisma(): PrismaClient {
  return {
    team: { findFirst: async () => null },
    project: { findFirst: async () => null },
  } as unknown as PrismaClient;
}

/** One binding as the authorization boundary answers it, with nothing omitted. */
export function testBinding(overrides: Partial<AuthzAccessBinding> = {}): AuthzAccessBinding {
  return {
    id: "binding-1",
    organizationId: "org-1",
    userId: "user-2",
    groupId: null,
    apiKeyId: null,
    role: "VIEWER",
    customRoleId: null,
    scopeType: "TEAM",
    scopeId: "team-1",
    createdAt: new Date(0),
    user: null,
    group: null,
    apiKey: null,
    customRole: null,
    ...overrides,
  };
}

export function createRoleTestApp(
  input: Readonly<{
    roles?: MemoryRoleRepository;
    permissions?: Partial<AuthzApi>;
    organizations?: Partial<OrganizationApi>;
    users?: Partial<UserApi>;
    entitlement?: Partial<EntitlementApi>;
    prisma?: PrismaClient;
  }> = {},
): { app: RoleApp; roles: MemoryRoleRepository } {
  const roles = input.roles ?? MemoryRoleRepository.create();

  const app = RoleApp.create({
    repositories: { roles },
    dependencies: {
      permissions: createApiFixture<AuthzApi>(input.permissions ?? {}, "AuthzApi"),
      organizations: createApiFixture<OrganizationApi>(
        input.organizations ?? {},
        "OrganizationApi",
      ),
      users: createApiFixture<UserApi>(input.users ?? {}, "UserApi"),
      entitlement: createApiFixture<EntitlementApi>(
        input.entitlement ?? { getActivePlan: async () => testPlan() },
        "EntitlementApi",
      ),
    },
    members: {
      prisma: input.prisma ?? testRolePrisma(),
    },
    config: void 0,
    resources: new ResourceScope(),
  });

  return { app, roles };
}
