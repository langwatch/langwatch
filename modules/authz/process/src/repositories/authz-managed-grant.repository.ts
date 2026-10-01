import type { OrganizationRole } from "@langwatch/authorization";
import type { PrincipalKind, GrantScopeTier, TeamUserRole } from "@langwatch/authz-contract";

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
  scopeType: GrantScopeTier;
  scopeId: string;
};

export type AuthzAssignableRoleRow = {
  id: string;
  permissions: unknown;
};

/** Who a grant was attached to, revoked or not. */
export type AuthzGrantPrincipalRow = {
  grantId: string;
  principal: { type: PrincipalKind; id: string | null };
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
export abstract class AuthzManagedGrantRepository {
  abstract hasBindingsForUser(input: { organizationId: string; userId: string }): Promise<boolean>;

  abstract hasLegacySharedTeamMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<boolean>;

  abstract findScopeRows(input: {
    organizationId: string;
    scopes: readonly {
      scopeType: GrantScopeTier;
      scopeId: string;
    }[];
  }): Promise<AuthzBindingScopeRow[]>;

  abstract findGroupMembers(input: {
    organizationId: string;
    groupIds: readonly string[];
  }): Promise<{ groupId: string; userId: string }[]>;

  abstract findOrganizationUserIds(input: { organizationId: string }): Promise<string[]>;

  /** Revoked grants included: a revocation's subscriber needs whom it took access from. */
  abstract findGrantPrincipals(input: {
    organizationId: string;
    grantIds: readonly string[];
  }): Promise<AuthzGrantPrincipalRow[]>;

  abstract findUserGroups(input: {
    organizationId: string;
    userId: string;
  }): Promise<AuthzUserGroupRow[]>;

  abstract findOrganizationRole(input: {
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

  abstract findBinding(input: {
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
