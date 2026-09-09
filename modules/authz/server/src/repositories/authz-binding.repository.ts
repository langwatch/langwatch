import type {
  OrganizationRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@langwatch/authz-contract";

export type AuthzBindingScopeRow =
  | {
      type: "ORGANIZATION";
      id: string;
      name: string;
      personalWorkspaceName: null;
    }
  | {
      type: "TEAM" | "PROJECT";
      id: string;
      name: string;
      personalWorkspaceName: string | null;
    };

export type AuthzManagedBindingRow = {
  id: string;
  organizationId: string;
  userId: string | null;
  groupId: string | null;
  apiKeyId: string | null;
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
  scopeId: string;
};

export type AuthzAssignableRoleRow = {
  id: string;
  permissions: unknown;
};

export type AuthzUserGroupRow = {
  groupId: string;
  group: {
    id: string;
    name: string;
    slug: string;
    scimSource: string | null;
  };
};

/** Private persistence facts needed by the binding-management methods. */
export abstract class AuthzBindingRepository {
  abstract hasBindingsForUser(input: { organizationId: string; userId: string }): Promise<boolean>;

  abstract hasLegacySharedTeamMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<boolean>;

  abstract findScopeRows(input: {
    organizationId: string;
    scopes: ReadonlyArray<{
      scopeType: RoleBindingScopeType;
      scopeId: string;
    }>;
  }): Promise<AuthzBindingScopeRow[]>;

  abstract findGroupMembers(input: {
    organizationId: string;
    groupIds: readonly string[];
  }): Promise<Array<{ groupId: string; userId: string }>>;

  abstract findUserGroups(input: {
    organizationId: string;
    userId: string;
  }): Promise<AuthzUserGroupRow[]>;

  abstract tryFindOrganizationRole(input: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationRole | null>;

  abstract isGroupInOrganization(input: {
    organizationId: string;
    groupId: string;
  }): Promise<boolean>;

  abstract isApiKeyInOrganization(input: {
    organizationId: string;
    apiKeyId: string;
  }): Promise<boolean>;

  abstract tryFindBinding(input: {
    organizationId: string;
    bindingId: string;
  }): Promise<AuthzManagedBindingRow | null>;

  abstract findDirectUserBindings(input: {
    organizationId: string;
    userId: string;
    bindingIds: readonly string[];
  }): Promise<AuthzManagedBindingRow[]>;

  abstract findAssignableRoles(input: {
    organizationId: string;
    roleIds: readonly string[];
  }): Promise<AuthzAssignableRoleRow[]>;
}
