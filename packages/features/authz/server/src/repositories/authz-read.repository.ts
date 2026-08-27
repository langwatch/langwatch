/**
 * ADR-092 — the read port. This package holds the authorization POLICIES
 * (what a snapshot means); concrete structural-database adapters implement
 * these queries inside this package.
 * Methods return stored facts - no policy - and follow the repository
 * naming convention (findX, never getX).
 */
import type {
  AuthzPrincipalRef,
  CollectedBinding,
  LegacyTeamMembership,
  ShareableResourceKind,
} from "@langwatch/authz-contract";

/** OrganizationUser.role, or null when no membership row exists. */
export type OrganizationRole = "ADMIN" | "MEMBER" | "EXTERNAL";

/**
 * The membership row as stored: its role, and whether an admin has disabled
 * it to stay within the licensed seat count.
 *
 * Both halves are FACTS, not policy - a disabled row keeps its role, and it
 * is the collector that decides a disabled membership is not a membership
 * (so `isOrgMember` goes false and the engine's gate denies). The role is
 * still reported because the denial wants to say WHICH gate closed, and
 * because re-enabling has to restore exactly what was there.
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

/** The already fail-safe, cached migration gate injected by composition. */
export type AuthzReadHeadSelector = (organizationId: string) => Promise<boolean>;

/**
 * The lineage reads both ports need: resolving a scope reference (read side)
 * and validating a write target's tenancy (write side) ask the same two
 * questions of the same rows. Declared once here so the two ports cannot
 * drift apart.
 */
export abstract class ScopeLineageRepository {
  /** A project's team + organization, or null when the project is unknown. */
  abstract tryFindProjectLineage(args: {
    projectId: string;
  }): Promise<{ teamId: string; organizationId: string } | null>;
  /** A team's organization, or null when the team is unknown. */
  abstract tryFindTeamOrganization(args: {
    teamId: string;
  }): Promise<{ organizationId: string } | null>;
}

export abstract class AuthzReadRepository extends ScopeLineageRepository {
  /**
   * The membership row, disabled or not, or null when there is none.
   *
   * Named for what it returns: the previous `findOrganizationRole` reported
   * only the role, which gave the collector no way to tell a seat-disabled
   * membership from an absent one - so a disabled member passed the engine's
   * membership gate and kept every permission.
   */
  abstract tryFindOrganizationMembership(args: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationMembership | null>;
  /** Direct user bindings - viaGroupId null. Fenced on an ACTIVE membership. */
  abstract findUserBindings(args: {
    userId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]>;
  /** Bindings reaching the user through a group - viaGroupId set. */
  abstract findGroupBindings(args: {
    userId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]>;
  abstract findApiKeyBindings(args: {
    apiKeyId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]>;
  /**
   * The user an API key belongs to, for the ADR-092 §9 owner ceiling.
   * `{ userId: null }` is a SERVICE key - it exists and has no owner, so it
   * carries no ceiling. `null` means the key itself is unknown.
   */
  abstract tryFindApiKeyOwner(apiKeyId: string): Promise<{ userId: string | null } | null>;
  abstract findLegacyTeamMemberships(args: {
    userId: string;
    organizationId: string;
  }): Promise<LegacyTeamMembership[]>;
  /**
   * The permission payloads for custom roles the principal's bindings
   * reference. The organization and principal are passed so the query can
   * fence the read to rows the caller could actually be bound to - a custom
   * role id alone is not a tenancy proof.
   */
  abstract findCustomRolePermissions(args: {
    organizationId: string;
    principal: AuthzPrincipalRef;
    customRoleIds: readonly string[];
  }): Promise<CustomRolePermissionsRow[]>;
  /**
   * ShareLink rows for the presented tokens against the given resource
   * links. Implementations MUST filter by token possession in the query -
   * returning unpresented rows would reopen the trace-id-guessing hole.
   *
   * `organizationId` is OPTIONAL: a caller who has already resolved the
   * project's lineage (deciding, say, which head to route to) may hand it
   * over so an implementation that would otherwise re-resolve it from the
   * project can skip that second read. A caller with no lineage of its own
   * omits it and an implementation that needs one resolves it itself.
   */
  abstract findShareLinks(args: {
    projectId: string;
    tokens: readonly string[];
    links: ReadonlyArray<{ kind: ShareableResourceKind; id: string }>;
    organizationId?: string;
  }): Promise<ShareLinkRow[]>;

  /**
   * OPTIONAL. A reader that routes between two heads implements this to hand
   * back a view of itself that answers from ONE head for as long as the
   * caller holds it.
   *
   * Why the port carries it at all: a collect is several reads, and the
   * per-organization cutover routing behind them is a cached decision with a
   * TTL. Without a pass boundary that TTL can expire BETWEEN two reads of one
   * collect, and the snapshot handed to the engine is then half legacy
   * bindings and half ledger grants — a decision made from a state that never
   * existed. `beginPass()` is where the collector says "these reads are one
   * answer"; a reader that owns a single head implements nothing and is
   * unaffected.
   *
   * It must return a view whose lifetime is the caller's, never `this` for a
   * reader that is shared (the composition root holds one collector for the
   * whole process), or the pin outlives every rollback.
   */
  abstract beginPass?(): AuthzReadRepository;
}
