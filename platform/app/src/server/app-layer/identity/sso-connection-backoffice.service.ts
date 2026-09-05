import type {
  SsoArrivalPolicy,
  SsoConnectionLifecycleState,
  SsoConnectionState,
  SsoDomainVerification,
} from "@langwatch/identity";
import type { SsoConnectionService } from "@langwatch/identity-server";
import { newSsoConnectionCommandId } from "@langwatch/identity-server";

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
  arrivalPolicy: SsoArrivalPolicy;
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

/**
 * The projection, as the back office reads it: a page of connections across
 * every customer, one connection by id, and the names behind the organization
 * ids those carry.
 *
 * `PrismaSsoConnectionBackofficeRepository` is the implementation, and the
 * search predicate lives with it — what an operator may search by is a
 * question about the columns, not about the surface.
 */
export interface SsoConnectionBackofficeReadsPort {
  findPage(args: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ connections: readonly SsoConnectionState[]; total: number }>;
  findById(args: { connectionId: string }): Promise<SsoConnectionState | null>;
  findOrganizationNames(args: {
    organizationIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>>;
}

export class SsoConnectionBackofficeService {
  constructor(
    private readonly deps: {
      reads: SsoConnectionBackofficeReadsPort;
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
    const { connections, total } = await this.deps.reads.findPage({
      page,
      pageSize,
      search,
    });
    const names = await this.deps.reads.findOrganizationNames({
      organizationIds: connections.map((state) => state.organizationId),
    });
    return {
      connections: connections.map((state) =>
        toBackofficeConnection({
          state,
          organizationName: names.get(state.organizationId) ?? null,
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
    const state = await this.deps.reads.findById({ connectionId });
    if (!state) return null;
    const names = await this.deps.reads.findOrganizationNames({
      organizationIds: [state.organizationId],
    });
    return toBackofficeConnection({
      state,
      organizationName: names.get(state.organizationId) ?? null,
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
}

interface ConnectionCommandArgs {
  organizationId: string;
  connectionId: string;
  operator: OperatorActor;
}

type DomainCommandArgs = ConnectionCommandArgs & { domain: string };

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
    arrivalPolicy: state.arrivalPolicy,
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
