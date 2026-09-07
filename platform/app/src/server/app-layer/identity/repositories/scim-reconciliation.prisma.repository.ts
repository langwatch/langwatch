/**
 * What the two reconciliation surfaces READ (ADR-122).
 *
 * Everything here is a read of event truth already written by D08: the
 * `ScimSyncState` projection, the `(connectionId, externalId) -> userId`
 * mapping, and the grants facts the directory authored (`source: "scim"`).
 * There is no write path in this file and there is not meant to be one — the
 * customer's remediation is the directory's next push, and the operator's one
 * act goes through a guarded command, not through here.
 *
 * The ORGANIZATION-scoped reads take the organization as the thing the query
 * is BUILT FROM rather than as a filter a caller passes alongside an id. That
 * is why `findSyncByIdForOrganization` takes both and answers null when they
 * disagree: naming another organization's connection has to read exactly like
 * naming one that does not exist, and it does so here rather than in a check
 * a caller could forget.
 *
 * The cross-customer reads are separate methods with no organization at all,
 * so a surface cannot reach them by accident: an organization-scoped caller
 * has no way to express "every customer" through the port it holds.
 */
import type { ScimSyncState } from "@langwatch/identity";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { rowToScimSync } from "./scim-sync-projection.prisma.repository";
import { rowToConnection } from "./sso-connection-projection.prisma.repository";

/**
 * One membership change the directory caused, as both surfaces read it.
 *
 * Derived from the grants head rather than from a SCIM event, because that
 * is where the consequence actually lives: `scim_user_pushed` says the
 * directory asked, and the grant says who now holds what. A removal is the
 * same row with `revokedAt` set — the ledger marks, it never deletes — which
 * is what lets "who did the directory take out last Tuesday" be answered at
 * all.
 */
export interface DirectoryCausedChange {
  grantId: string;
  /** The person, when the principal is one. Null for a group binding. */
  userId: string | null;
  principalType: string;
  roleKey: string | null;
  scopeType: string;
  scopeId: string;
  /** Whether the directory gave this access or took it away. */
  kind: "attached" | "removed";
  occurredAtMs: number;
}

/** One person the directory manages, as the OPERATOR surface reads them. */
export interface DirectoryIdentityRow {
  connectionId: string;
  externalId: string;
  userId: string;
  createdAtMs: number;
  updatedAtMs: number;
}

/** What an organization-scoped surface may ask for. */
export interface ScimReconciliationReadRepository {
  findAllSyncsForOrganization(args: {
    organizationId: string;
  }): Promise<ScimSyncState[]>;
  findSyncByIdForOrganization(args: {
    organizationId: string;
    connectionId: string;
  }): Promise<ScimSyncState | null>;
  countManagedPeople(args: {
    connectionIds: string[];
  }): Promise<Map<string, number>>;
  findDirectoryCausedChanges(args: {
    organizationId: string;
    limit: number;
  }): Promise<DirectoryCausedChange[]>;
  findPeopleNames(args: { userIds: string[] }): Promise<Map<string, string>>;
  findAllConnections(args: {
    organizationId: string;
  }): Promise<OrganizationConnection[]>;
}

/**
 * One of the organization's single sign-on connections, as the SCIM page
 * lists them. A token is minted against one of these, and a connection that
 * has never had a token still has to appear — otherwise the page can only
 * offer connections that are already set up, which is the wrong half.
 */
export interface OrganizationConnection {
  connectionId: string;
  providerId: string;
  state: string;
  verifiedDomains: string[];
}

/** What the cross-customer operator surface may ask for, and nothing else. */
export interface ScimOversightReadRepository {
  findAllSyncs(args: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ syncs: ScimSyncState[]; total: number }>;
  findSyncById(args: { connectionId: string }): Promise<ScimSyncState | null>;
  findDirectoryIdentities(args: {
    connectionId: string;
    limit: number;
  }): Promise<DirectoryIdentityRow[]>;
  findOrganizationNames(args: {
    organizationIds: string[];
  }): Promise<Map<string, string>>;
}

/**
 * How many recent directory-caused changes a panel reads at once.
 *
 * A cap rather than a page, because the panel answers "what has the directory
 * been doing lately" and a customer who needs the whole history has the audit
 * page. Fifty is enough to cover a nightly full push of a small directory
 * without turning the settings page into a table nobody scrolls.
 */
export const RECENT_DIRECTORY_CHANGE_LIMIT = 50;

export class PrismaScimReconciliationRepository
  implements ScimReconciliationReadRepository, ScimOversightReadRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findAllSyncsForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ScimSyncState[]> {
    const rows = await this.prisma.scimSyncState.findMany({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(rowToScimSync);
  }

  async findSyncByIdForOrganization({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<ScimSyncState | null> {
    const row = await this.prisma.scimSyncState.findFirst({
      where: { id: connectionId, organizationId },
    });
    return row ? rowToScimSync(row) : null;
  }

  /**
   * How many people each connection's directory currently manages.
   *
   * Grouped on `connectionId` rather than counted per connection, so a
   * settings page listing four connections still makes one query. The count
   * is of MAPPINGS, which is the honest number: it is how many people this
   * directory has told us about, not how many members the organization has.
   */
  async countManagedPeople({
    connectionIds,
  }: {
    connectionIds: string[];
  }): Promise<Map<string, number>> {
    if (connectionIds.length === 0) return new Map();
    const grouped = await this.prisma.scimExternalId.groupBy({
      by: ["connectionId"],
      where: { connectionId: { in: connectionIds } },
      _count: { _all: true },
    });
    return new Map(
      grouped.map((row) => [row.connectionId, row._count._all] as const),
    );
  }

  /**
   * The membership changes the directory authored, newest first.
   *
   * `source: "scim"` is the whole predicate. It is set on ATTACH and survives
   * the revoke, because a revoke marks the same row — so one query answers
   * both halves of "what did the directory do", and a removal cannot go
   * missing just because nothing re-stamped it on the way out.
   *
   * Ordered by the later of the two times the row carries, which is what a
   * reader means by "recent": a grant attached in March and revoked last
   * Tuesday is last Tuesday's news.
   */
  async findDirectoryCausedChanges({
    organizationId,
    limit,
  }: {
    organizationId: string;
    limit: number;
  }): Promise<DirectoryCausedChange[]> {
    const rows = await this.prisma.grant.findMany({
      where: { organizationId, source: "scim" },
      orderBy: [{ revokedAt: "desc" }, { occurredAt: "desc" }],
      take: limit,
      select: {
        id: true,
        principalType: true,
        principalId: true,
        roleKey: true,
        scopeType: true,
        scopeId: true,
        occurredAt: true,
        revokedAt: true,
      },
    });
    return rows
      .map((row) => ({
        grantId: row.id,
        userId: row.principalType === "USER" ? row.principalId : null,
        principalType: row.principalType as string,
        roleKey: row.roleKey,
        scopeType: row.scopeType as string,
        scopeId: row.scopeId,
        kind: (row.revokedAt ? "removed" : "attached") as
          | "attached"
          | "removed",
        occurredAtMs: (row.revokedAt ?? row.occurredAt).getTime(),
      }))
      .sort((a, b) => b.occurredAtMs - a.occurredAtMs);
  }

  /**
   * The people a directory-caused change was about, so a customer reads a
   * name rather than an identifier. Name before address: a removal is read
   * by somebody checking whether the right person left, and a name is what
   * they are checking against.
   */
  async findPeopleNames({
    userIds,
  }: {
    userIds: string[];
  }): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true, email: true },
    });
    return new Map(
      rows.map((row) => [row.id, row.name ?? row.email ?? row.id] as const),
    );
  }

  /**
   * The organization's connections. Built from the organization, so a
   * connection belonging to somebody else is not excluded by a filter — it
   * was never in the result set to be excluded from.
   */
  async findAllConnections({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationConnection[]> {
    const rows = await this.prisma.ssoConnection.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => {
      // Through the projection's own translation rather than reading the JSON
      // column here: which key inside `idpMetadata` holds the provider is the
      // connection projection's business, and a second reader of it would
      // eventually disagree with the first.
      const connection = rowToConnection(row);
      return {
        connectionId: connection.connectionId,
        providerId: connection.idpMetadata.providerId,
        state: connection.state,
        verifiedDomains: connection.verifiedDomains,
      };
    });
  }

  async findAllSyncs({
    page,
    pageSize,
    search,
  }: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ syncs: ScimSyncState[]; total: number }> {
    const where = search ? syncSearchFilter(search) : {};
    const [rows, total] = await Promise.all([
      this.prisma.scimSyncState.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: page * pageSize,
        take: pageSize,
      }),
      this.prisma.scimSyncState.count({ where }),
    ]);
    return { syncs: rows.map(rowToScimSync), total };
  }

  async findSyncById({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<ScimSyncState | null> {
    const row = await this.prisma.scimSyncState.findUnique({
      where: { id: connectionId },
    });
    return row ? rowToScimSync(row) : null;
  }

  /**
   * The `externalId <-> userId` mapping detail, per connection.
   *
   * Operator-only by construction: there is no organization-scoped method
   * that answers it. A customer looking at their own connection sees how many
   * people the directory manages and never which identifier it knows each of
   * them by — that identifier is the thing a support case turns on when a
   * push matched the wrong nobody, and it is nothing an administrator has a
   * use for.
   */
  async findDirectoryIdentities({
    connectionId,
    limit,
  }: {
    connectionId: string;
    limit: number;
  }): Promise<DirectoryIdentityRow[]> {
    const rows = await this.prisma.scimExternalId.findMany({
      where: { connectionId },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        connectionId: true,
        externalId: true,
        userId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows.map((row) => ({
      connectionId: row.connectionId,
      externalId: row.externalId,
      userId: row.userId,
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    }));
  }

  /**
   * Organization names for the operator list. An operator scanning a
   * cross-customer table against `org_LVYcVYGW1AJqvp2G8vcVd` has not been
   * told anything they can check — the same reason the connection back office
   * resolves them.
   */
  async findOrganizationNames({
    organizationIds,
  }: {
    organizationIds: string[];
  }): Promise<Map<string, string>> {
    const unique = [...new Set(organizationIds)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.organization.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name] as const));
  }
}

/**
 * What the operator list searches on: the connection, the organization, or
 * the state. Ids rather than prose, because that is what a support case
 * arrives carrying.
 */
function syncSearchFilter(search: string): Prisma.ScimSyncStateWhereInput {
  const term = search.trim();
  return {
    OR: [
      { id: { contains: term, mode: "insensitive" } },
      { connectionId: { contains: term, mode: "insensitive" } },
      { organizationId: { contains: term, mode: "insensitive" } },
      { state: { equals: term.toUpperCase() } },
    ],
  };
}
