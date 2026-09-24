// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  DirectoryIdentityRow,
  ScimDirectoryOwnership,
  ScimRequestLogEntry,
  ScimRequestRecord,
  ScimTokenRecord,
} from "@langwatch/enterprise-scim-contract";
import type { Instant } from "@langwatch/time";
import type { UserProfile } from "@langwatch/user-contract";

/** SCIM-owned persistence records. Prisma models do not cross this seam. */
export type ScimUserRecord = UserProfile;
/**
 * One organization's own SCIM state for a person: the userName a directory
 * pushed, the display name it sent and whether it says they are active. The
 * account underneath belongs to nobody in particular, so none of this is
 * written on it — a person in two organizations carries two of these.
 */
export interface ScimUserResourceRecord {
  organizationId: string;
  userId: string;
  userName: string;
  name: string | null;
  active: boolean;
  deletedAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
}
/** A person this organization holds, with its directory resource where one exists. */
export interface ScimOrganizationUserRecord {
  user: ScimUserRecord;
  resource: ScimUserResourceRecord | null;
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
  /** The directory connection that pushed this group, or null for a group
   *  created by hand and for the ones that predate connection scoping. */
  connectionId: string | null;
  createdAt: Instant;
  updatedAt: Instant;
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
export type { ScimTokenRecord };
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
export abstract class ScimGrantRepository {
  abstract listRoleBindings(scope: ScimGrantBindingScope): Promise<ScimRoleBindingRecord[]>;
}

export abstract class ScimRepository extends ScimGrantRepository {
  abstract findOrganizationBySsoDomain(input: { domain: string }): Promise<{ id: string } | null>;
  // Declared as properties of function type, not method shorthand: tests hold
  // a mock repository and reference these members unbound (e.g.
  // `expect(repo.addMembership).toHaveBeenCalledWith(...)`), which
  // `typescript/unbound-method` flags against method shorthand. None carries
  // `this` state, so the property form changes nothing at runtime.
  abstract findMembership: (input: {
    organizationId: string;
    userId: string;
  }) => Promise<ScimMembershipRecord | null>;
  /**
   * Who this organization holds: everyone carrying a live directory resource,
   * then the members who carry none. A person whose resource is deleted is in
   * neither half — the tombstone is the answer, not the membership row.
   */
  abstract findOrganizationUsers: (input: {
    organizationId: string;
    /** Matched against the directory userName, and against the account's own
     *  address for a member no directory has claimed. */
    userName?: string;
    /** When present the page narrows to these members and no others; an empty
     *  array is an empty page rather than "everybody". */
    userIds?: readonly string[];
    startIndex: number;
    count: number;
  }) => Promise<{ rows: ScimOrganizationUserRecord[]; total: number }>;
  abstract findUserResource: (input: {
    organizationId: string;
    userId: string;
  }) => Promise<ScimUserResourceRecord | null>;
  /** The account a live directory resource of this name belongs to, if any. */
  abstract findUserByResourceName: (input: {
    organizationId: string;
    userName: string;
  }) => Promise<ScimUserRecord | null>;
  /** Whether a member no directory has claimed already answers to this name. */
  abstract hasLegacyNameConflict: (input: {
    organizationId: string;
    userId?: string;
    userName: string;
  }) => Promise<boolean>;
  abstract saveUserResource: (input: {
    organizationId: string;
    userId: string;
    userName: string;
    name: string | null;
    active: boolean;
  }) => Promise<ScimUserResourceRecord>;
  abstract markUserResourceDeleted: (input: {
    organizationId: string;
    userId: string;
    userName: string;
    name: string | null;
  }) => Promise<void>;
  abstract addMembership: (input: {
    organizationId: string;
    userId: string;
    role: string;
  }) => Promise<void>;
  abstract removeMembership: (input: { organizationId: string; userId: string }) => Promise<void>;
  abstract findGroup(input: {
    organizationId: string;
    id: string;
  }): Promise<ScimGroupRecord | null>;
  abstract listGroups(input: {
    organizationId: string;
    /** Which connection's groups are in reach. A legacy token (null) keeps
     *  organization-wide reach; a scoped token sees its own groups and the
     *  ones that predate connection scoping. */
    connectionId?: string | null;
    displayName?: string;
    externalId?: string;
    startIndex: number;
    count: number;
  }): Promise<{
    rows: (ScimGroupRecord & { members: ScimGroupMembershipRecord[] })[];
    total: number;
  }>;
  abstract findGroupByExternalId(input: {
    organizationId: string;
    connectionId: string | null;
    externalId: string;
  }): Promise<ScimGroupRecord | null>;
  abstract createGroup(input: {
    organizationId: string;
    name: string;
    slug: string;
    externalId: string | null;
    connectionId: string | null;
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
  abstract createToken: (input: {
    organizationId: string;
    connectionId: string;
    hashedToken: string;
    description: string | null;
  }) => Promise<{ id: string }>;
  abstract findTokens(organizationId: string): Promise<ScimTokenRecord[]>;
  abstract findToken(input: {
    organizationId: string;
    tokenId: string;
  }): Promise<ScimTokenIdentity | null>;
  abstract revokeToken: (input: { organizationId: string; tokenId: string }) => Promise<boolean>;
  abstract revokeTokensForConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<number>;
  abstract findTokenByHash(hashedToken: string): Promise<ScimTokenIdentity | null>;
  abstract findTokenIdsForConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<string[]>;
  /**
   * Re-homes these tokens and the connection's directory identities onto
   * another connection at once. An identity the target already holds stays
   * the target's own, and the source's claim on it is dropped.
   */
  abstract moveDirectoryToConnection(input: {
    organizationId: string;
    fromConnectionId: string;
    toConnectionId: string;
    tokenIds: readonly string[];
  }): Promise<void>;
  abstract recordTokenUse: (input: { tokenId: string; usedAt: Instant }) => Promise<void>;
  abstract scimConnectionExists(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<boolean>;
  // ── What the directory asked, and what we answered (ADR-126) ─────────────
  abstract recordRequest: (request: ScimRequestRecord) => Promise<void>;
  abstract findRequestLog(input: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<ScimRequestLogEntry[]>;
  /** The ids of rows that have aged out, at most `limit` of them. */
  abstract findExpiredRequestIds(input: { before: Instant; limit: number }): Promise<string[]>;
  abstract deleteRequests(input: { ids: readonly string[] }): Promise<number>;
  abstract findDirectoryUserId(input: {
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
  abstract findDirectoryConnectionsForUser(input: { userId: string }): Promise<string[]>;
  /** Whom these connections' directories have claimed, one row per identifier. */
  abstract findDirectoryOwnership(input: {
    connectionIds: string[];
  }): Promise<ScimDirectoryOwnership[]>;
  abstract findDirectoryExternalIds(input: {
    connectionIds: string[];
  }): Promise<{ userId: string; externalId: string }[]>;
  /**
   * The `externalId <-> userId` mapping on one connection, newest first: the
   * operator's detail (ADR-122). Keyed on the connection, never the identifier
   * alone — the same identifier on two connections is two different people.
   */
  abstract findDirectoryIdentities(input: {
    connectionId: string;
    limit: number;
  }): Promise<DirectoryIdentityRow[]>;
}
