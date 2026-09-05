import type { PrismaClient } from "~/generated/prisma/client";

/**
 * The cross-organization reads the operator lookup takes.
 *
 * Every method here crosses tenants on purpose — that is what the surface is
 * for, and it is why the READ is authorized and recorded before any of them
 * runs. They are gathered behind one port so the service never holds a
 * Prisma client, and so the whole cross-tenant surface area of this
 * deliverable is one file a reviewer can read end to end.
 */
export interface IdentityLookupReadsRepository {
  findIdentifiersByValue(input: {
    value: string;
  }): Promise<readonly LookupIdentifierRow[]>;

  findIdentifiersForUser(input: {
    userId: string;
  }): Promise<readonly LookupIdentifierRow[]>;

  findUsers(input: {
    userIds: readonly string[];
  }): Promise<readonly LookupUserRow[]>;

  findMemberships(input: {
    userIds: readonly string[];
  }): Promise<readonly LookupMembershipRow[]>;

  findOrganizationNames(input: {
    organizationIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>>;

  findSessions(input: { userId: string }): Promise<readonly LookupSessionRow[]>;

  findInvitations(input: {
    email: string;
  }): Promise<readonly LookupInvitationRow[]>;

  findClaimsAwaitingReview(input: {
    domains: readonly string[];
  }): Promise<readonly LookupDomainClaimRow[]>;

  findClaimQueue(input: {
    limit: number;
  }): Promise<readonly LookupDomainClaimRow[]>;

  findConnectionForDomain(input: {
    domain: string;
  }): Promise<LookupConnectionRow | null>;

  findRecentOperatorActivity(input: {
    limit: number;
  }): Promise<readonly LookupOperatorActivityRow[]>;
}

/**
 * One thing an operator did on this surface, read back off the SAME audit
 * trail every repair writes to. Not a second trail: a surface that kept its
 * own record of reads would be a record nobody cross-checks against the one
 * that holds the writes.
 */
export interface LookupOperatorActivityRow {
  auditId: string;
  operatorUserId: string | null;
  operatorName: string | null;
  /** The verb, without the surface prefix: `resolve`, `detachMethod`, … */
  act: string;
  /** The address resolved, where the act named one. */
  address: string | null;
  atMs: number;
}

export interface LookupIdentifierRow {
  identifierId: string;
  userId: string;
  provider: string;
  value: string | null;
  domain: string | null;
  state: string;
  connectionId: string | null;
  verifiedAtMs: number | null;
  attachedAtMs: number;
  detachedAtMs: number | null;
}

export interface LookupUserRow {
  userId: string;
  name: string | null;
  email: string | null;
}

export interface LookupMembershipRow {
  userId: string;
  organizationId: string;
  organizationName: string | null;
  role: string;
}

export interface LookupSessionRow {
  sessionId: string;
  identifierId: string | null;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface LookupInvitationRow {
  inviteId: string;
  email: string;
  organizationId: string;
  organizationName: string | null;
  invitedByName: string | null;
  status: string;
  expiresAtMs: number | null;
  createdAtMs: number;
}

export interface LookupDomainClaimRow {
  connectionId: string;
  organizationId: string;
  organizationName: string | null;
  domain: string;
  /** When the connection last moved, which for a CLAIMED one is the claim. */
  waitingSinceMs: number;
}

export interface LookupConnectionRow {
  connectionId: string;
  organizationId: string;
  organizationName: string | null;
  state: string;
  providerId: string;
}

/** How many rows a single-address lookup will read before it stops. A
 *  support case is about one person, and a value held by more than this is
 *  a data problem rather than a lookup. */
const MATCH_CEILING = 50;

export class PrismaIdentityLookupRepository
  implements IdentityLookupReadsRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findIdentifiersByValue({
    value,
  }: {
    value: string;
  }): Promise<readonly LookupIdentifierRow[]> {
    const rows = await this.prisma.identifier.findMany({
      // Every state, DETACHED included: "who holds any part of this address"
      // is the question, and a detached identifier is exactly the answer a
      // support case turns on.
      where: { value },
      orderBy: { attachedAt: "desc" },
      take: MATCH_CEILING,
    });
    return rows.map(toIdentifierRow);
  }

  async findIdentifiersForUser({
    userId,
  }: {
    userId: string;
  }): Promise<readonly LookupIdentifierRow[]> {
    const rows = await this.prisma.identifier.findMany({
      where: { userId },
      orderBy: { attachedAt: "desc" },
    });
    return rows.map(toIdentifierRow);
  }

  async findUsers({
    userIds,
  }: {
    userIds: readonly string[];
  }): Promise<readonly LookupUserRow[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, name: true, email: true },
    });
    return rows.map((row) => ({
      userId: row.id,
      name: row.name,
      email: row.email,
    }));
  }

  async findMemberships({
    userIds,
  }: {
    userIds: readonly string[];
  }): Promise<readonly LookupMembershipRow[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.organizationUser.findMany({
      where: { userId: { in: [...userIds] } },
      select: {
        userId: true,
        organizationId: true,
        role: true,
        organization: { select: { name: true } },
      },
    });
    return rows.map((row) => ({
      userId: row.userId,
      organizationId: row.organizationId,
      organizationName: row.organization?.name ?? null,
      role: row.role,
    }));
  }

  async findOrganizationNames({
    organizationIds,
  }: {
    organizationIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>> {
    const unique = [...new Set(organizationIds)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.organization.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async findSessions({
    userId,
  }: {
    userId: string;
  }): Promise<readonly LookupSessionRow[]> {
    const rows = await this.prisma.session.findMany({
      where: { userId },
      select: {
        id: true,
        identifierId: true,
        createdAt: true,
        expires: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      sessionId: row.id,
      identifierId: row.identifierId,
      createdAtMs: row.createdAt.getTime(),
      expiresAtMs: row.expires.getTime(),
    }));
  }

  async findInvitations({
    email,
  }: {
    email: string;
  }): Promise<readonly LookupInvitationRow[]> {
    const rows = await this.prisma.organizationInvite.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      select: {
        id: true,
        email: true,
        organizationId: true,
        status: true,
        expiration: true,
        createdAt: true,
        organization: { select: { name: true } },
        requestedByUser: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      inviteId: row.id,
      email: row.email,
      organizationId: row.organizationId,
      organizationName: row.organization?.name ?? null,
      invitedByName: row.requestedByUser?.name ?? null,
      status: row.status,
      expiresAtMs: row.expiration?.getTime() ?? null,
      createdAtMs: row.createdAt.getTime(),
    }));
  }

  async findClaimsAwaitingReview({
    domains,
  }: {
    domains: readonly string[];
  }): Promise<readonly LookupDomainClaimRow[]> {
    if (domains.length === 0) return [];
    const rows = await this.prisma.ssoConnection.findMany({
      where: { claimedDomains: { hasSome: [...domains] } },
      select: CLAIM_SELECT,
      orderBy: { updatedAt: "asc" },
    });
    return rows.flatMap((row) => toClaimRows(row, domains));
  }

  async findClaimQueue({
    limit,
  }: {
    limit: number;
  }): Promise<readonly LookupDomainClaimRow[]> {
    const rows = await this.prisma.ssoConnection.findMany({
      where: { NOT: { claimedDomains: { isEmpty: true } } },
      select: CLAIM_SELECT,
      // Longest wait first: the queue is read top-down, and the claim that
      // has waited longest is the one a customer is chasing.
      orderBy: { updatedAt: "asc" },
      take: limit,
    });
    return rows.flatMap((row) => toClaimRows(row, null));
  }

  async findConnectionForDomain({
    domain,
  }: {
    domain: string;
  }): Promise<LookupConnectionRow | null> {
    const row = await this.prisma.ssoConnection.findFirst({
      // Every state, like the routing port: a paused connection still owns
      // its domain, and saying so is the whole point of this panel.
      where: { verifiedDomains: { has: domain } },
      select: {
        id: true,
        organizationId: true,
        state: true,
        providerId: true,
      },
    });
    if (!row) return null;
    const organization = await this.prisma.organization.findUnique({
      where: { id: row.organizationId },
      select: { name: true },
    });
    return {
      connectionId: row.id,
      organizationId: row.organizationId,
      organizationName: organization?.name ?? null,
      state: row.state,
      providerId: row.providerId,
    };
  }

  async findRecentOperatorActivity({
    limit,
  }: {
    limit: number;
  }): Promise<readonly LookupOperatorActivityRow[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { action: { startsWith: IDENTITY_LOOKUP_AUDIT_PREFIX } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        userId: true,
        action: true,
        args: true,
        createdAt: true,
      },
    });
    const operatorIds = rows
      .map((row) => row.userId)
      .filter((userId): userId is string => userId !== null);
    const operators = await this.findUsers({ userIds: operatorIds });
    const named = new Map(
      operators.map((operator) => [operator.userId, operator.name]),
    );
    return rows.map((row) => ({
      auditId: row.id,
      operatorUserId: row.userId,
      operatorName: row.userId ? (named.get(row.userId) ?? null) : null,
      act: row.action.slice(IDENTITY_LOOKUP_AUDIT_PREFIX.length),
      address: addressOf(row.args),
      atMs: row.createdAt.getTime(),
    }));
  }
}

/** The address off an audit row's arguments, when it carried one. */
function addressOf(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const address = (args as { address?: unknown }).address;
  return typeof address === "string" && address.length > 0 ? address : null;
}

/** The prefix every act on this surface is recorded under. */
export const IDENTITY_LOOKUP_AUDIT_PREFIX = "identityLookup.";

const CLAIM_SELECT = {
  id: true,
  organizationId: true,
  claimedDomains: true,
  updatedAt: true,
} as const;

interface ClaimRowShape {
  id: string;
  organizationId: string;
  claimedDomains: string[];
  updatedAt: Date;
}

function toClaimRows(
  row: ClaimRowShape,
  domains: readonly string[] | null,
): LookupDomainClaimRow[] {
  return row.claimedDomains
    .filter((domain) => domains === null || domains.includes(domain))
    .map((domain) => ({
      connectionId: row.id,
      organizationId: row.organizationId,
      // Resolved by the service, which already batches organization names
      // for the people panel; a per-row join here would be one query each.
      organizationName: null,
      domain,
      waitingSinceMs: row.updatedAt.getTime(),
    }));
}

interface IdentifierRowShape {
  id: string;
  userId: string;
  provider: string;
  value: string | null;
  domain: string | null;
  state: string;
  connectionId: string | null;
  verifiedAt: Date | null;
  attachedAt: Date;
  detachedAt: Date | null;
}

function toIdentifierRow(row: IdentifierRowShape): LookupIdentifierRow {
  return {
    identifierId: row.id,
    userId: row.userId,
    provider: row.provider,
    value: row.value,
    domain: row.domain,
    state: row.state,
    connectionId: row.connectionId,
    verifiedAtMs: row.verifiedAt?.getTime() ?? null,
    attachedAtMs: row.attachedAt.getTime(),
    detachedAtMs: row.detachedAt?.getTime() ?? null,
  };
}
