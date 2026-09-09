import type { AuthzAccessBinding, AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { RoleBindingScopeType } from "@langwatch/role-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import {
  RoleBindingIdPort,
  RoleCustomRolePlanPort,
  RoleScopePort,
} from "../../ports/role.port.ts";
import { MemoryRoleRepository } from "../../repositories/memory/memory.role.repository.ts";
import { RoleApp } from "../role.app.ts";

/** Lets every binding through: the fence has its own suite in the owning feature. */
export class AllowingTestRoleScope extends RoleScopePort {
  async assertNoPersonalTeamScope(_input: {
    scopes: { scopeType: RoleBindingScopeType; scopeId: string }[];
  }): Promise<void> {}
}

/** A deployment whose plan carries custom roles. */
export class AllowingTestRolePlan extends RoleCustomRolePlanPort {
  async assertCustomRolesAllowed(_input: { organizationId: string }): Promise<void> {}
}

/** A deployment whose plan does not, refusing by the sentence the process owns. */
export class RefusingTestRolePlan extends RoleCustomRolePlanPort {
  async assertCustomRolesAllowed(_input: { organizationId: string }): Promise<void> {
    throw new Error("Custom roles require an Enterprise plan");
  }
}

/** Counting binding ids, so a test can assert which one was attached. */
export class CountingTestRoleBindingIds extends RoleBindingIdPort {
  #next = 0;

  newBindingId(): string {
    this.#next += 1;

    return `binding_${this.#next}`;
  }
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
    plan?: RoleCustomRolePlanPort;
    scope?: RoleScopePort;
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
    },
    infrastructure: {
      scope: input.scope ?? new AllowingTestRoleScope(),
      plan: input.plan ?? new AllowingTestRolePlan(),
      bindingIds: new CountingTestRoleBindingIds(),
    },
    config: void 0,
    resources: new ResourceScope(),
  });

  return { app, roles };
}
