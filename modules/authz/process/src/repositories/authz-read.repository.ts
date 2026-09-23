/**
 * ADR-092 — the read port. This package holds authorization POLICIES;
 * adapters implement the queries. Methods return stored facts, no policy,
 * and follow the repository naming convention (findX, never getX).
 */
import type {
  AuthzPrincipalRef,
  CollectedBinding,
  ShareableResourceKind,
} from "@langwatch/authz-contract";
import type { Instant } from "@langwatch/time";

/** OrganizationUser.role, or null when no membership row exists. */
export type OrganizationRole = "ADMIN" | "MEMBER" | "EXTERNAL";

/**
 * OrganizationUser row: role + disabled flag. Both are facts; collector
 * decides if disabled membership counts.
 */
export type OrganizationMembership = {
  role: OrganizationRole;
  disabled: boolean;
};

/** A CustomRole row's permission payload, unparsed - the collector applies
 *  the documented lenient parse (malformed JSON degrades to no grants). */
export type CustomRolePermissionsRow = {
  id: string;
  permissions: unknown;
};

/** ADR-057 ShareLink row, exactly the fields the shim reads. Liveness
 *  (expiry, view budget) is POLICY and stays in the collector. `resourceType`
 *  restates the Prisma enum rather than reusing ShareableResourceKind, since
 *  it mirrors the stored column and the collector maps one onto the other. */
export type ShareLinkRow = {
  resourceType: "TRACE" | "THREAD";
  resourceId: string;
  projectId: string;
  visibility: "PUBLIC" | "ORGANIZATION" | "PROJECT";
  expiresAt: Instant | null;
  maxViews: number | null;
  viewCount: number;
};

type FindFirstDelegate = {
  findFirst(args: unknown): Promise<unknown>;
};
type FindUniqueDelegate = {
  findUnique(args: unknown): Promise<unknown>;
};
type FindManyDelegate = {
  findMany(args: unknown): Promise<unknown[]>;
};

/**
 * The structural database capability used by private AuthZ repositories.
 * A runtime may provide Prisma (normally through a one-time structural cast),
 * but generated client types and values never cross this package boundary.
 */
export type AuthzDatabase = Readonly<{
  organizationUser: FindFirstDelegate;
  roleBinding: FindManyDelegate;
  teamUser: FindManyDelegate;
  customRole: FindManyDelegate;
  apiKey: FindUniqueDelegate & FindManyDelegate;
  shareLink: FindManyDelegate;
  project: FindUniqueDelegate;
  team: FindUniqueDelegate;
  groupMembership: FindManyDelegate;
  grant: FindManyDelegate & FindFirstDelegate;
  role: FindManyDelegate & FindFirstDelegate;
  grantUsage: FindManyDelegate;
  user: FindManyDelegate;
  group: FindManyDelegate;
}>;

/**
 * The lineage reads both ports need: resolving a scope reference (read
 * side) and validating a write target's tenancy (write side) ask the same
 * two questions. Declared once here so the two ports cannot drift apart.
 */
export abstract class ScopeLineageRepository {
  // Properties of function type rather than method shorthand: tests hold a
  // mock built to this class and assert on these members via
  // `expect(...).toHaveBeenCalledWith`, which is unsafe against a
  // method-shorthand member under `unbound-method`.
  /** A project's team + organization, or null when the project is unknown. */
  abstract findProjectLineage: (args: {
    projectId: string;
  }) => Promise<{ teamId: string; organizationId: string } | null>;
  /** A team's organization, or null when the team is unknown. */
  abstract findTeamOrganization: (args: {
    teamId: string;
  }) => Promise<{ organizationId: string } | null>;
}

export abstract class AuthzReadRepository extends ScopeLineageRepository {
  // Function-typed properties below, not method shorthand: test mocks are
  // asserted on directly, which trips `unbound-method` on shorthand members.

  /**
   * The membership row, disabled or not, or null when there is none. The
   * previous `findOrganizationRole` reported only the role, so a disabled
   * member looked like an absent one and kept every permission.
   */
  abstract findOrganizationMembership: (args: {
    userId: string;
    organizationId: string;
  }) => Promise<OrganizationMembership | null>;
  /** Direct user bindings - viaGroupId null. Fenced on an ACTIVE membership. */
  abstract findUserBindings: (args: {
    userId: string;
    organizationId: string;
  }) => Promise<CollectedBinding[]>;
  /** Bindings reaching the user through a group - viaGroupId set. */
  abstract findGroupBindings: (args: {
    userId: string;
    organizationId: string;
  }) => Promise<CollectedBinding[]>;
  abstract findApiKeyBindings: (args: {
    apiKeyId: string;
    organizationId: string;
  }) => Promise<CollectedBinding[]>;
  /**
   * The user an API key belongs to, for the ADR-092 §9 owner ceiling.
   * `{ userId: null }` is a SERVICE key - it exists and has no owner, so it
   * carries no ceiling. `null` means the key itself is unknown.
   */
  abstract findApiKeyOwner: (apiKeyId: string) => Promise<{ userId: string | null } | null>;
  /**
   * The permission payloads for custom roles the principal's bindings
   * reference, fenced by organization + principal - a role id alone is
   * not a tenancy proof.
   */
  abstract findCustomRolePermissions: (args: {
    organizationId: string;
    principal: AuthzPrincipalRef;
    customRoleIds: readonly string[];
  }) => Promise<CustomRolePermissionsRow[]>;
  /**
   * ShareLink rows for presented tokens; MUST filter by token possession in
   * query. organizationId optional to skip lineage re-resolve.
   */
  abstract findShareLinks: (args: {
    projectId: string;
    tokens: readonly string[];
    links: readonly { kind: ShareableResourceKind; id: string }[];
    organizationId?: string;
  }) => Promise<ShareLinkRow[]>;

  /**
   * OPTIONAL: route between two heads by returning single-head view. Prevents
   * cutover TTL expiring mid-collect (bindings + grants mismatch).
   */
  abstract beginPass?(): AuthzReadRepository;
}
