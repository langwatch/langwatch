import type {
  SsoConnectionLifecycleState,
  SsoConnectionState,
  SsoConnectionType,
  SsoDomainVerification,
} from "@langwatch/identity";
import type { SsoConnectionService } from "@langwatch/identity-server";
import {
  newSsoConnectionCommandId,
  newSsoConnectionId,
} from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { rowToConnection } from "./repositories/sso-connection-projection.prisma.repository";

/**
 * What the back office reads and commands (D05 tier 1).
 *
 * The write half is a THIN pass-through on purpose: every verb here mints a
 * command id, stamps the operator as the actor, and hands the rest to
 * `SsoConnectionService`, whose guards are the only thing that decides
 * anything. There is no second copy of the lifecycle here, no branch on
 * state, and no path from this class to an `SsoConnection` row — the row is a
 * projection of the log, and a write to it would be overwritten by the next
 * fold.
 *
 * The read half exists because the back office needs a LIST, and the guards'
 * read port answers about one connection at a time. It resolves organization
 * names alongside, because an operator confirming a destructive action on
 * `org_LVYcVYGW1AJqvp2G8vcVd` has not been told anything they can check.
 */

/** One row of the back office's connection list. */
export interface BackofficeSsoConnection {
  connectionId: string;
  organizationId: string;
  /** Resolved server-side. Null when the organization no longer exists — the
   *  surface withholds destructive controls rather than confirm against an
   *  identifier the operator cannot verify. */
  organizationName: string | null;
  type: string;
  state: SsoConnectionLifecycleState;
  claimedDomains: string[];
  approvedDomains: string[];
  verifiedDomains: string[];
  domainVerifications: SsoDomainVerification[];
  providerId: string;
  issuer: string | null;
  allowsJit: boolean;
  source: string;
  testLoginAccountId: string | null;
  rejection: { domain: string; note: string } | null;
  pendingVerificationDomain: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface BackofficeSsoConnectionList {
  connections: BackofficeSsoConnection[];
  total: number;
}

/** The operator issuing a command, as the surface knows them. */
export interface OperatorActor {
  userId: string;
}

export class SsoConnectionBackofficeService {
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      connections: () => SsoConnectionService;
    },
  ) {}

  async list({
    page,
    pageSize,
    search,
  }: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<BackofficeSsoConnectionList> {
    const where = search ? searchFilter(search) : {};
    const [rows, total] = await Promise.all([
      this.deps.prisma.ssoConnection.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: page * pageSize,
        take: pageSize,
      }),
      this.deps.prisma.ssoConnection.count({ where }),
    ]);
    const names = await this.organizationNames(
      rows.map((row) => row.organizationId),
    );
    return {
      connections: rows.map((row) =>
        toBackofficeConnection({
          state: rowToConnection(row),
          organizationName: names.get(row.organizationId) ?? null,
        }),
      ),
      total,
    };
  }

  async getById({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<BackofficeSsoConnection | null> {
    const row = await this.deps.prisma.ssoConnection.findUnique({
      where: { id: connectionId },
    });
    if (!row) return null;
    const names = await this.organizationNames([row.organizationId]);
    return toBackofficeConnection({
      state: rowToConnection(row),
      organizationName: names.get(row.organizationId) ?? null,
    });
  }

  /**
   * Register a connection for an organization.
   *
   * Both protocols, since D09: SAML was refused here because nothing in the
   * product could terminate it, and something can now.
   *
   * What this surface still does not do is take credentials. A connection
   * registered here carries no references, so the fold writes the engine no
   * provider and the router reads "not configured" — which is exactly true
   * until an administrator supplies the client secret or the identity
   * provider's metadata through Settings. An operator registering the SHAPE
   * of a connection ahead of that conversation is the tier-1 journey, and it
   * has never been the thing that makes a sign-in arrive.
   */
  async registerConnection({
    organizationId,
    type,
    providerId,
    issuer,
    allowsJit,
    operator,
  }: {
    organizationId: string;
    type: SsoConnectionType;
    providerId: string;
    issuer: string | null;
    allowsJit: boolean;
    operator: OperatorActor;
  }): Promise<{ connectionId: string }> {
    const connectionId = newSsoConnectionId();
    await this.deps.connections().registerConnection({
      ...this.command({ organizationId, connectionId, operator }),
      type,
      idp: {
        issuer,
        providerId,
        clientIdRef: null,
        secretRef: null,
        certRefs: [],
      },
      allowsJit,
    });
    return { connectionId };
  }

  async claimDomain(args: DomainCommandArgs): Promise<void> {
    await this.deps.connections().claimDomain({
      ...this.command(args),
      domain: args.domain,
    });
  }

  async approveDomainClaim(args: DomainCommandArgs): Promise<void> {
    await this.deps.connections().approveDomainClaim({
      ...this.command(args),
      domain: args.domain,
    });
  }

  async rejectDomainClaim(
    args: DomainCommandArgs & { note: string },
  ): Promise<void> {
    await this.deps.connections().rejectDomainClaim({
      ...this.command(args),
      domain: args.domain,
      note: args.note,
    });
  }

  async attestDomain(args: DomainCommandArgs): Promise<void> {
    await this.deps.connections().attestDomain({
      ...this.command(args),
      domain: args.domain,
    });
  }

  async activateConnection(
    args: ConnectionCommandArgs & { testLoginAccountId: string },
  ): Promise<void> {
    await this.deps.connections().activateConnection({
      ...this.command(args),
      testLoginAccountId: args.testLoginAccountId,
    });
  }

  async suspendConnection(
    args: ConnectionCommandArgs & { reason: string | null },
  ): Promise<void> {
    await this.deps.connections().suspendConnection({
      ...this.command(args),
      reason: args.reason,
    });
  }

  async resumeConnection(args: ConnectionCommandArgs): Promise<void> {
    await this.deps.connections().resumeConnection(this.command(args));
  }

  async requestTeardown(
    args: ConnectionCommandArgs & { reason: string | null; graceMs: number },
  ): Promise<void> {
    await this.deps.connections().requestTeardown({
      ...this.command(args),
      reason: args.reason,
      graceMs: args.graceMs,
    });
  }

  /**
   * The identity block every command carries. Minted here, once, so no caller
   * can supply an actor — the operator the surface authenticated is the
   * actor, and the history says so.
   */
  private command({
    organizationId,
    connectionId,
    operator,
  }: ConnectionCommandArgs) {
    return {
      tenantId: organizationId,
      organizationId,
      connectionId,
      commandId: newSsoConnectionCommandId(),
      occurredAtMs: Date.now(),
      actor: { type: "user" as const, id: operator.userId },
      source: "self-serve" as const,
    };
  }

  private async organizationNames(
    organizationIds: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(organizationIds)];
    if (unique.length === 0) return new Map();
    const rows = await this.deps.prisma.organization.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}

interface ConnectionCommandArgs {
  organizationId: string;
  connectionId: string;
  operator: OperatorActor;
}

type DomainCommandArgs = ConnectionCommandArgs & { domain: string };

/**
 * Search over the identifiers and domains an operator would have to hand: a
 * connection id from a log line, an organization id from a support thread, or
 * the domain the customer told them about.
 */
function searchFilter(search: string) {
  const term = search.trim();
  return {
    OR: [
      { id: { contains: term, mode: "insensitive" as const } },
      { organizationId: { contains: term, mode: "insensitive" as const } },
      { verifiedDomains: { has: term.toLowerCase() } },
      { claimedDomains: { has: term.toLowerCase() } },
      { approvedDomains: { has: term.toLowerCase() } },
    ],
  };
}

export function toBackofficeConnection({
  state,
  organizationName,
}: {
  state: SsoConnectionState;
  organizationName: string | null;
}): BackofficeSsoConnection {
  return {
    connectionId: state.connectionId,
    organizationId: state.organizationId,
    organizationName,
    type: state.type,
    state: state.state,
    claimedDomains: state.claimedDomains,
    approvedDomains: state.approvedDomains,
    verifiedDomains: state.verifiedDomains,
    domainVerifications: state.domainVerifications,
    providerId: state.idpMetadata.providerId,
    issuer: state.idpMetadata.issuer,
    allowsJit: state.allowsJit,
    source: state.source,
    testLoginAccountId: state.testLoginAccountId,
    rejection: state.rejection,
    // The ceremony's domain, never its token hash: a hash is a proof
    // artifact, and no operator reading a list has anything to do with one.
    pendingVerificationDomain: state.pendingVerification?.domain ?? null,
    createdAtMs: state.createdAtMs,
    updatedAtMs: state.updatedAtMs,
  };
}
