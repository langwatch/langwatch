import type { AuthzAccessBinding, AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { OrganizationApi, OrganizationTeam } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { MemoryRoleRepository } from "../../repositories/memory/memory.role.repository.ts";
import { RoleModule } from "../role.app.ts";

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

/** One team as the organization answers it; not a personal workspace unless a test says so. */
export function testTeam(overrides: Partial<OrganizationTeam> = {}): OrganizationTeam {
  return {
    id: "team-1",
    name: "Platform",
    slug: "platform",
    organizationId: "org-1",
    isPersonal: false,
    ownerUserId: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
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
    entitlement?: Partial<EntitlementApi>;
  }> = {},
): { app: RoleModule; roles: MemoryRoleRepository } {
  const roles = input.roles ?? MemoryRoleRepository.create();

  const app = RoleModule.create({
    repositories: { roles },
    dependencies: {
      // A caller holds every permission unless a test says otherwise (the escalation rule).
      permissions: createApiFixture<AuthzApi>(
        { findPermissionsBeyondCaller: async () => [], ...input.permissions },
        "AuthzApi",
      ),
      organizations: createApiFixture<OrganizationApi>(
        { getTeamById: async ({ teamId }) => testTeam({ id: teamId }), ...input.organizations },
        "OrganizationApi",
      ),
      entitlement: createApiFixture<EntitlementApi>(
        input.entitlement ?? { getActivePlan: async () => testPlan() },
        "EntitlementApi",
      ),
    },
    config: void 0,
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });

  return { app, roles };
}
