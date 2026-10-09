// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  DEFAULT_SSO_ARRIVAL_POLICY,
  type SsoArrivalPolicy,
  SsoConnectionIssuerNotPublicError,
  type SsoConnectionLifecycleState,
  type SsoConnectionState,
  type SsoDomainVerification,
} from "@langwatch/identity";
import {
  type HostResolver,
  publicHopFor,
  systemHostResolver,
} from "~/server/app-layer/identity/public-egress";
import type { SsoConnectionService } from "./sso-connection.service";
import type { SsoConnectionHistoryEntryView } from "./sso-connection-history.service";
import {
  newSsoConnectionCommandId,
  newSsoConnectionId,
} from "./sso-connection-id";

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
      /** The connection's raw event history (ADR-117 SS5), read exactly as
       *  the organization's own authentication page reads it — the words are
       *  the same, because the events are the same. */
      history: {
        getHistory(input: {
          organizationId: string;
          connectionId: string;
          limit?: number;
        }): Promise<SsoConnectionHistoryEntryView[]>;
      };
      /** How an issuer's hostname is resolved before it is accepted. Injected
       *  so the refusal can be tested without a resolver on the network. */
      resolveHost?: HostResolver;
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

  /**
   * One connection's raw event history, as an operator reads it (ADR-117
   * SS5, D04).
   *
   * The organization is resolved from the connection rather than taken from
   * the caller — this surface names a connection, never a tenant, and the
   * history log is scoped by the SAME organization the projection already
   * carries. Null for a connection that does not exist, which is the answer
   * `getById` already gives for the identical case.
   */
  async getHistory({
    connectionId,
    limit,
  }: {
    connectionId: string;
    limit?: number;
  }): Promise<SsoConnectionHistoryEntryView[] | null> {
    const state = await this.deps.reads.findById({ connectionId });
    if (!state) return null;
    return this.deps.history.getHistory({
      organizationId: state.organizationId,
      connectionId,
      limit,
    });
  }

  /**
   * Register a connection for an organization.
   *
   * Both protocols are registrable here now that D09 terminates SAML; what
   * the surface still owes either of them is the issuer check below.
   */
  async registerConnection({
    organizationId,
    type,
    providerId,
    issuer,
    arrivalPolicy = DEFAULT_SSO_ARRIVAL_POLICY,
    operator,
  }: {
    organizationId: string;
    type: "oidc" | "saml";
    providerId: string;
    issuer: string | null;
    arrivalPolicy?: SsoArrivalPolicy;
    operator: OperatorActor;
  }): Promise<{ connectionId: string }> {
    await this.refuseIssuerWeWouldDialOurselves(issuer);
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
      arrivalPolicy,
    });
    return { connectionId };
  }

  /**
   * Refuses an issuer that does not resolve to a public address.
   *
   * The string typed here is not inert: it becomes the URL this process later
   * dials for the provider's OpenID configuration, so accepting one that
   * answers `127.0.0.1` or a link-local metadata address makes a settings
   * form into a request we make to ourselves. This is the one moment a person
   * is present to correct it.
   *
   * It is a check at the door, not the pinned dial `fetchFollowingPublicHosts`
   * performs — the discovery request itself is made inside better-auth, which
   * takes no dispatcher from us, so a name that answers publicly now and
   * privately later is not stopped here. Closing that needs this application
   * to own discovery rather than hand over a URL, which is a larger change
   * than a guard. Refusing what is plainly private at the door is worth
   * having in the meantime and costs an operator nothing.
   */
  private async refuseIssuerWeWouldDialOurselves(
    issuer: string | null,
  ): Promise<void> {
    if (issuer === null || issuer.length === 0) return;
    const hop = await publicHopFor({
      url: issuer,
      resolveHost: this.deps.resolveHost ?? systemHostResolver,
    });
    if (hop.ok) return;
    throw new SsoConnectionIssuerNotPublicError(
      `issuer refused before registration: ${hop.refusal}`,
    );
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

  async attestDomain(
    args: DomainCommandArgs & { evidenceRef: string; note: string },
  ): Promise<void> {
    await this.deps.connections().attestDomain({
      ...this.command(args),
      domain: args.domain,
      evidenceRef: args.evidenceRef,
      note: args.note,
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
