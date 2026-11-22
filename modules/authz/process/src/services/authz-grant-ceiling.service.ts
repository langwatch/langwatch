import {
  assertBindingScopeCanGrantPermissions,
  CustomRoleIdRequiredError,
  CustomRoleNotAssignableError,
  GrantExceedsCallerPermissionsError,
  permissionsConferred,
  RoleBindingNotFoundError,
  type AuthzBindingWrite,
  type AuthzGrantCaller,
  type AuthzPrincipalRef,
} from "@langwatch/authz-contract";

import type {
  AuthzManagedBindingRow,
  AuthzManagedGrantRepository,
} from "../repositories/authz-managed-grant.repository.ts";
import type { AuthzGrantWriterPermissions } from "./authz-grant-writer.service.ts";

const WIRE_SCOPE = { ORGANIZATION: "organization", TEAM: "team", PROJECT: "project" } as const;

/** Whether a custom role's stored permissions are a list at all. */
function isPermissionList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** The permission names in a custom role's stored list. */
function permissionNames(list: unknown[]): string[] {
  return list.filter((permission): permission is string => typeof permission === "string");
}

function assertScopeCanGrantRole({
  binding,
  rolesById,
}: {
  binding: AuthzBindingWrite;
  rolesById: ReadonlyMap<string, readonly string[]>;
}): void {
  if (binding.scopeType === "ORGANIZATION" || !binding.customRoleId) {
    return;
  }

  assertBindingScopeCanGrantPermissions({
    scopeType: binding.scopeType,
    permissions: rolesById.get(binding.customRoleId) ?? [],
  });
}

/** The escalation ceiling: a binding never confers what the caller lacks at its scope. */
export class AuthzGrantCeilingService {
  static create(options: {
    bindings: Pick<AuthzManagedGrantRepository, "findAssignableRoles" | "findBinding">;
    permissions: Pick<AuthzGrantWriterPermissions, "findPermissionsBeyondCaller">;
  }): AuthzGrantCeilingService {
    return new AuthzGrantCeilingService(options.bindings, options.permissions);
  }

  private constructor(
    private readonly bindings: Pick<
      AuthzManagedGrantRepository,
      "findAssignableRoles" | "findBinding"
    >,
    private readonly permissions: Pick<AuthzGrantWriterPermissions, "findPermissionsBeyondCaller">,
  ) {}

  async validateRoles({
    organizationId,
    bindings,
  }: {
    organizationId: string;
    bindings: readonly AuthzBindingWrite[];
  }): Promise<ReadonlyMap<string, readonly string[]>> {
    const customBindings = bindings.filter((binding) => {
      if (binding.role !== "CUSTOM") {
        return false;
      }

      if (!binding.customRoleId) {
        throw new CustomRoleIdRequiredError();
      }

      return true;
    });
    const roleIds = [
      ...new Set(
        customBindings.flatMap((binding) => (binding.customRoleId ? [binding.customRoleId] : [])),
      ),
    ];
    if (roleIds.length === 0) {
      return new Map();
    }

    const roles = await this.bindings.findAssignableRoles({
      organizationId,
      roleIds,
    });
    const rolesById = new Map<string, readonly string[]>();
    for (const role of roles) {
      if (!isPermissionList(role.permissions)) throw new CustomRoleNotAssignableError(role.id);
      rolesById.set(role.id, permissionNames(role.permissions));
    }
    const missingRoleId = roleIds.find((roleId) => !rolesById.has(roleId));
    if (missingRoleId) {
      throw new CustomRoleNotAssignableError(missingRoleId);
    }

    for (const binding of customBindings) {
      assertScopeCanGrantRole({ binding, rolesById });
    }

    return rolesById;
  }

  /**
   * The ceiling for a ledger write that arrives already composed (`attachBindings`): a person or
   * key never grants beyond what it holds; a `system` write follows from an act already checked.
   */
  async assertBindingsWithinCaller({
    organizationId,
    caller,
    bindings,
  }: {
    organizationId: string;
    caller: AuthzGrantCaller;
    bindings: readonly AuthzBindingWrite[];
  }): Promise<void> {
    if (caller.type === "system" || bindings.length === 0) return;
    const rolesById = await this.validateRoles({ organizationId, bindings });
    await this.assertWithinCaller({ organizationId, caller, bindings, rolesById });
  }

  /**
   * The same ceiling for a role change: the new role and the current one, at the
   * binding's scope.
   */
  async assertRoleChangeWithinCaller({
    organizationId,
    caller,
    bindingId,
    role,
    customRoleId,
  }: {
    organizationId: string;
    caller: AuthzGrantCaller;
    bindingId: string;
    role: AuthzBindingWrite["role"];
    customRoleId: string | null;
  }): Promise<void> {
    if (caller.type === "system") return;
    const binding = await this.bindings.findBinding({ organizationId, bindingId });
    if (!binding) throw new RoleBindingNotFoundError(bindingId);
    await this.assertBindingsWithinCaller({
      organizationId,
      caller,
      bindings: [{ role, customRoleId, scopeType: binding.scopeType, scopeId: binding.scopeId }],
    });
    await this.assertHeldWithinCaller({ organizationId, caller, binding });
  }

  /**
   * A caller changes or takes away only a binding that confers nothing beyond their
   * own standing.
   */
  async assertHeldWithinCaller({
    organizationId,
    caller,
    binding,
  }: {
    organizationId: string;
    caller: AuthzPrincipalRef;
    binding: AuthzManagedBindingRow;
  }): Promise<void> {
    const roles = binding.customRoleId
      ? await this.bindings.findAssignableRoles({
          organizationId,
          roleIds: [binding.customRoleId],
        })
      : [];
    const rolesById = new Map(
      roles.map((role) => [
        role.id,
        isPermissionList(role.permissions) ? permissionNames(role.permissions) : [],
      ]),
    );
    await this.assertWithinCaller({ organizationId, caller, bindings: [binding], rolesById });
  }

  /** Every door's one escalation check: a binding never confers what the caller lacks there. */
  async assertWithinCaller({
    organizationId,
    caller,
    bindings,
    rolesById,
  }: {
    organizationId: string;
    caller: AuthzPrincipalRef;
    bindings: readonly AuthzBindingWrite[];
    rolesById: ReadonlyMap<string, readonly string[]>;
  }): Promise<void> {
    for (const binding of bindings) {
      const conferred = [
        ...permissionsConferred({
          role: binding.role,
          scopeType: binding.scopeType,
          customPermissions: rolesById.get(binding.customRoleId ?? "") ?? [],
        }),
      ];
      // Nobody answers for an anonymous write, so it grants nothing (a public demo view included).
      const missing =
        caller.type === "anonymous"
          ? conferred
          : await this.permissions.findPermissionsBeyondCaller({
              organizationId,
              caller,
              scope: { type: WIRE_SCOPE[binding.scopeType], id: binding.scopeId },
              permissions: conferred,
            });
      if (missing.length > 0) throw new GrantExceedsCallerPermissionsError(missing);
    }
  }
}
