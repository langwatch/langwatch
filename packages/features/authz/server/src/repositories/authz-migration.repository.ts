import type { TeamUserRole } from "@langwatch/authz-contract";

export type LegacyTeamRow = {
  userId: string;
  teamId: string;
  role: TeamUserRole;
  customRoleId: string | null;
  createdAtMs: number;
};

export type LegacyBindingRow = {
  id: string;
  userId: string | null;
  groupId: string | null;
  apiKeyId: string | null;
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
  createdAtMs: number;
};

export type LegacyRoleRow = {
  id: string;
  name: string;
  description: string | null;
  permissions: unknown;
  kind: string;
  createdAtMs: number;
};

export type OrganizationMemberFact = {
  userId: string;
  role: string;
  createdAtMs: number;
};

export type RoleHeadRow = {
  id: string;
  name: string;
  description: string | null;
  permissions: unknown;
  kind: string;
};

export type ShareLinkFactRow = {
  id: string;
  token: string;
  resourceType: "TRACE" | "THREAD";
  resourceId: string;
  projectId: string;
  userId: string | null;
  visibility: "PUBLIC" | "ORGANIZATION" | "PROJECT";
  expiresAtMs: number | null;
  maxViews: number | null;
  viewCount: number;
  createdAtMs: number;
};

export type ExternalMemberFact = {
  userId: string;
  createdAtMs: number;
};

export type ProjectCredentialFact = {
  projectId: string;
  createdAtMs: number;
};

export type GrantHeadRow = {
  id: string;
  principalType: string;
  principalId: string | null;
  roleKey: string | null;
  legacyRole: string | null;
  source: string;
  scopeType: string;
  scopeId: string;
  revoked: boolean;
};

export type ResourceGrantRow = {
  grantId: string;
  source: string;
  token: string | null;
  resourceKind: string | null;
  resourceId: string;
  projectId: string | null;
  principalType: string;
  principalId: string | null;
  expiresAtMs: number | null;
  maxViews: number | null;
  viewCount: number;
};

export type ResourceGrantUsageSeed = {
  grantId: string;
  projectId: string;
  viewCount: number;
};

/** Storage contract for the one ADR-110 AuthZ import. */
export abstract class AuthzMigrationRepository {
  abstract tryFindOrganizationCreatedAtMs(args: {
    organizationId: string;
  }): Promise<number | null>;

  abstract findLegacyBindingRows(args: {
    organizationId: string;
  }): Promise<LegacyBindingRow[]>;

  abstract findLegacyRoleRows(args: {
    organizationId: string;
  }): Promise<LegacyRoleRow[]>;

  abstract findOrganizationMembers(args: {
    organizationId: string;
  }): Promise<OrganizationMemberFact[]>;

  abstract findLegacyTeamRows(args: {
    organizationId: string;
  }): Promise<LegacyTeamRow[]>;

  abstract findShareLinkRows(args: {
    organizationId: string;
  }): Promise<ShareLinkFactRow[]>;

  abstract findExternalMemberFacts(args: {
    organizationId: string;
  }): Promise<ExternalMemberFact[]>;

  abstract findProjectCredentialFacts(args: {
    organizationId: string;
  }): Promise<ProjectCredentialFact[]>;

  abstract findGroupMemberships(args: {
    organizationId: string;
  }): Promise<Array<{ userId: string; groupId: string }>>;

  abstract findGrantHeadRows(args: {
    organizationId: string;
  }): Promise<GrantHeadRow[]>;

  abstract findRoleHeads(args: {
    organizationId: string;
  }): Promise<RoleHeadRow[]>;

  abstract findResourceGrantRows(args: {
    organizationId: string;
  }): Promise<ResourceGrantRow[]>;

  abstract seedResourceGrantUsage(args: {
    organizationId: string;
    seeds: readonly ResourceGrantUsageSeed[];
  }): Promise<void>;
}
