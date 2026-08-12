/**
 * ADR-092 — the read port. This package holds the authorization POLICIES
 * (what a snapshot means); the app holds the QUERIES, as a Prisma
 * repository implementing this interface
 * (platform/app/src/server/authz/repositories/authz-read.prisma.repository.ts).
 * Methods return stored facts - no policy - and follow the repository
 * naming convention (findX, never getX).
 */
import type { CollectedBinding, LegacyTeamMembership } from "@langwatch/authz";

/** OrganizationUser.role, or null when no membership row exists. */
export type OrganizationRole = "ADMIN" | "MEMBER" | "EXTERNAL";

/** A CustomRole row's permission payload, unparsed - the collector applies
 *  the documented lenient parse (malformed JSON degrades to no grants). */
export type CustomRolePermissionsRow = {
  id: string;
  permissions: unknown;
};

/** An ADR-057 ShareLink row, exactly the fields the shim reads. Liveness
 *  (expiry, view budget) is POLICY and stays in the collector - the
 *  repository returns what is stored. */
export type ShareLinkRow = {
  resourceType: "TRACE" | "THREAD";
  resourceId: string;
  projectId: string;
  visibility: "PUBLIC" | "ORGANIZATION" | "PROJECT";
  expiresAt: Date | null;
  maxViews: number | null;
  viewCount: number;
};

export interface AuthzReadRepository {
  findOrganizationRole(args: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationRole | null>;
  /** Direct user bindings - viaGroupId null. */
  findUserBindings(args: {
    userId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]>;
  /** Bindings reaching the user through a group - viaGroupId set. */
  findGroupBindings(args: {
    userId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]>;
  findApiKeyBindings(args: {
    apiKeyId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]>;
  findLegacyTeamMemberships(args: {
    userId: string;
    organizationId: string;
  }): Promise<LegacyTeamMembership[]>;
  findCustomRolePermissions(args: {
    customRoleIds: readonly string[];
  }): Promise<CustomRolePermissionsRow[]>;
  /**
   * ShareLink rows for the presented tokens against the given resource
   * links. Implementations MUST filter by token possession in the query -
   * returning unpresented rows would reopen the trace-id-guessing hole.
   */
  findShareLinks(args: {
    projectId: string;
    tokens: readonly string[];
    links: ReadonlyArray<{ kind: "trace" | "thread"; id: string }>;
  }): Promise<ShareLinkRow[]>;
  /** A project's team + organization, or null when the project is unknown. */
  findProjectLineage(args: {
    projectId: string;
  }): Promise<{ teamId: string; organizationId: string } | null>;
  /** A team's organization, or null when the team is unknown. */
  findTeamOrganization(args: {
    teamId: string;
  }): Promise<{ organizationId: string } | null>;
}
