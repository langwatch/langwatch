// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** SCIM-owned persistence records. Prisma models do not cross this seam. */
export interface ScimUserRecord {
  id: string;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
  image: string | null;
  pendingSsoSetup: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  deactivatedAt: Date | null;
}
export interface ScimMembershipRecord {
  userId: string;
  organizationId: string;
  role?: string;
  departmentId?: string | null;
  user: ScimUserRecord;
}
export interface ScimGroupMembershipRecord {
  userId: string;
  groupId: string;
  user: ScimGroupMemberUserRecord;
}
export interface ScimGroupMemberUserRecord {
  id: string;
  email: string | null;
  name: string | null;
}
export interface ScimGroupRecord {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  scimSource: string | null;
  externalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface ScimRoleBindingRecord {
  id: string;
  userId: string | null;
  groupId: string | null;
  apiKeyId: string | null;
  scopeType: string;
  scopeId: string;
  role: string;
  customRoleId: string | null;
}

/** The exact grant slice an IdP statement is authoritative for. */
export type ScimGrantBindingScope =
  | {
      kind: "organization-membership";
      organizationId: string;
      userId: string;
    }
  | {
      kind: "group";
      organizationId: string;
      groupId: string;
    }
  | {
      kind: "member-offboarding";
      organizationId: string;
      userId: string;
    };
export interface ScimTokenRecord {
  id: string;
  organizationId: string;
  connectionId: string | null;
  description: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}
export interface ScimTokenIdentity {
  id: string;
  organizationId: string;
  connectionId: string | null;
}

export interface ScimDirectoryIdentityRecord {
  connectionId: string;
  externalId: string;
  userId: string;
}

/** Semantic store used by the SCIM service; no transport or ORM vocabulary. */
export abstract class ScimGrantRepositoryPort {
  abstract listRoleBindings(scope: ScimGrantBindingScope): Promise<ScimRoleBindingRecord[]>;
}

export abstract class ScimRepositoryPort extends ScimGrantRepositoryPort {
  abstract tryFindOrganizationBySsoDomain(input: {
    domain: string;
  }): Promise<{ id: string } | null>;
  abstract tryFindMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<ScimMembershipRecord | null>;
  abstract listMemberships(input: {
    organizationId: string;
    email?: string;
    startIndex: number;
    count: number;
  }): Promise<{ rows: ScimMembershipRecord[]; total: number }>;
  abstract addMembership(input: {
    organizationId: string;
    userId: string;
    role: string;
  }): Promise<void>;
  abstract removeMembership(input: { organizationId: string; userId: string }): Promise<void>;
  abstract tryFindGroup(input: {
    organizationId: string;
    id: string;
  }): Promise<ScimGroupRecord | null>;
  abstract listGroups(input: {
    organizationId: string;
    displayName?: string;
    startIndex: number;
    count: number;
  }): Promise<{
    rows: Array<ScimGroupRecord & { members: ScimGroupMembershipRecord[] }>;
    total: number;
  }>;
  abstract createGroup(input: {
    organizationId: string;
    name: string;
    slug: string;
    externalId: string | null;
  }): Promise<ScimGroupRecord>;
  abstract renameGroup(input: { id: string; name: string }): Promise<void>;
  abstract deleteGroup(input: { id: string }): Promise<void>;
  abstract listGroupMembers(input: { groupId: string }): Promise<ScimGroupMembershipRecord[]>;
  abstract listGroupMemberIds(input: { groupId: string }): Promise<string[]>;
  abstract addGroupMember(input: {
    groupId: string;
    organizationId: string;
    userId: string;
  }): Promise<void>;
  abstract removeGroupMembers(input: { groupId: string; userIds: string[] }): Promise<void>;
  abstract groupSlugExists(input: { organizationId: string; slug: string }): Promise<boolean>;
  abstract createToken(input: {
    organizationId: string;
    connectionId: string;
    hashedToken: string;
    description: string | null;
  }): Promise<{ id: string }>;
  abstract listTokens(organizationId: string): Promise<ScimTokenRecord[]>;
  abstract tryFindToken(input: {
    organizationId: string;
    tokenId: string;
  }): Promise<ScimTokenIdentity | null>;
  abstract revokeToken(input: { organizationId: string; tokenId: string }): Promise<boolean>;
  abstract revokeTokensForConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<number>;
  abstract tryFindTokenByHash(hashedToken: string): Promise<ScimTokenIdentity | null>;
  abstract recordTokenUse(input: { tokenId: string; usedAt: Date }): Promise<void>;
  abstract scimConnectionExists(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<boolean>;
  abstract tryFindDirectoryUserId(input: {
    connectionId: string;
    externalId: string;
  }): Promise<string | null>;
  abstract rememberDirectoryIdentity(input: ScimDirectoryIdentityRecord): Promise<void>;
  abstract forgetDirectoryIdentity(input: {
    connectionId: string;
    externalId: string;
  }): Promise<void>;
  abstract forgetDirectoryIdentitiesForUser(input: {
    connectionId: string;
    userId: string;
  }): Promise<void>;
  abstract listDirectoryConnectionsForUser(input: { userId: string }): Promise<string[]>;
}
