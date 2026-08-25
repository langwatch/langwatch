import type { RoleBindingScopeType } from "@langwatch/role-contract";

export abstract class RoleScopePort {
  abstract assertNoPersonalTeamScope(input: {
    scopes: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>;
  }): Promise<void>;
}

export abstract class RolePermissionPort {
  abstract isOrganizationExclusive(permission: string): boolean;
  abstract organizationExclusiveScopeError(input: {
    permission: string;
    scopeType: RoleBindingScopeType;
  }): Error;
}
