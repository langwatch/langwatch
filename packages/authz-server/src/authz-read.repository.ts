/**
 * ADR-092 — the read port. This package holds the authorization POLICIES
 * (what a snapshot means); the app holds the QUERIES, as a Prisma
 * repository implementing this interface
 * (platform/app/src/server/authz/repositories/authz-read.prisma.repository.ts).
 * Methods return stored facts - no policy - and follow the repository
 * naming convention (findX, never getX).
 */
import type {
  AuthzPrincipalRef,
  CollectedBinding,
  LegacyTeamMembership,
  ShareableResourceKind,
} from "@langwatch/authz";

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
 *  repository returns what is stored.
 *
 *  `resourceType` deliberately restates the Prisma enum rather than reusing
 *  ShareableResourceKind: it mirrors the stored column's spelling, and the
 *  collector is the seam that maps one onto the other. */
export type ShareLinkRow = {
  resourceType: "TRACE" | "THREAD";
  resourceId: string;
  projectId: string;
  visibility: "PUBLIC" | "ORGANIZATION" | "PROJECT";
  expiresAt: Date | null;
  maxViews: number | null;
  viewCount: number;
};

/**
 * The lineage reads both ports need: resolving a scope reference (read side)
 * and validating a write target's tenancy (write side) ask the same two
 * questions of the same rows. Declared once here so the two ports cannot
 * drift apart.
 */
export interface ScopeLineageRepository {
  /** A project's team + organization, or null when the project is unknown. */
  findProjectLineage(args: {
    projectId: string;
  }): Promise<{ teamId: string; organizationId: string } | null>;
  /** A team's organization, or null when the team is unknown. */
  findTeamOrganization(args: {
    teamId: string;
  }): Promise<{ organizationId: string } | null>;
}

export interface AuthzReadRepository extends ScopeLineageRepository {
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
  /**
   * The user an API key belongs to, for the ADR-092 §9 owner ceiling.
   * `{ userId: null }` is a SERVICE key - it exists and has no owner, so it
   * carries no ceiling. `null` means the key itself is unknown.
   */
  findApiKeyOwner(apiKeyId: string): Promise<{ userId: string | null } | null>;
  findLegacyTeamMemberships(args: {
    userId: string;
    organizationId: string;
  }): Promise<LegacyTeamMembership[]>;
  /**
   * The permission payloads for custom roles the principal's bindings
   * reference. The organization and principal are passed so the query can
   * fence the read to rows the caller could actually be bound to - a custom
   * role id alone is not a tenancy proof.
   */
  findCustomRolePermissions(args: {
    organizationId: string;
    principal: AuthzPrincipalRef;
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
    links: ReadonlyArray<{ kind: ShareableResourceKind; id: string }>;
  }): Promise<ShareLinkRow[]>;
}
