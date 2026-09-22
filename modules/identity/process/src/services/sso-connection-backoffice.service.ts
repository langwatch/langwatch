import {
  type SsoArrivalPolicy,
  type SsoConnectionHistoryEntryView,
  type SsoConnectionLifecycleState,
  type SsoConnectionState,
  type SsoDomainVerification,
  SsoSamlNotSelfServeError,
} from "@langwatch/identity-contract";
import { nowInstant } from "@langwatch/time";

import type { SsoConnectionBackofficeRepository } from "../repositories/sso-connection-backoffice.repository.ts";
import { newSsoConnectionCommandId, newSsoConnectionId } from "../rules/sso-connection-id.rules.ts";
import type { SsoConnectionHistoryService } from "./sso-connection-history.service.ts";
import type { SsoConnectionService } from "./sso-connection.service.ts";

/**
 * What the back office reads and commands (D05 tier 1). The write half is a THIN pass-through on
 * purpose: every verb here mints a command id, stamps the operator as the actor, and hands the rest
 * to `SsoConnectionService`, whose guards are the only thing that decides anything.
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
  /** What proved each domain — not yet its ADR-123 condition, which the
   *  back-office schema does not carry. */
  domainVerifications: Pick<
    SsoDomainVerification,
    "domain" | "method" | "actorId" | "verifiedAtMs"
  >[];
  providerId: string;
  issuer: string | null;
  /** Who the connection admits, as the aggregate holds it. */
  arrivalPolicy: SsoArrivalPolicy;
  /** DERIVED from the arrival policy: `admit` and nothing else. Kept beside
   *  it for one release, for readers written before the policy existed. */
  allowsJit: boolean;
  source: string;
  testLoginAccountId: string | null;
  rejection: { domain: string; note: string } | null;
  pendingVerificationDomain: string | null;
  /** When the ceremony in flight stops proving anything; null when none is
   *  in flight, or when it does not expire. */
  pendingVerificationExpiresAtMs: number | null;
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
  static create(deps: {
    reads: SsoConnectionBackofficeRepository;
    connections: () => SsoConnectionService;
    /** The same words the organization's own page reads, because the events
     *  are the same events. */
    history: () => SsoConnectionHistoryService;
  }): SsoConnectionBackofficeService {
    return new SsoConnectionBackofficeService(deps);
  }

  private constructor(
    private readonly deps: {
      reads: SsoConnectionBackofficeRepository;
      connections: () => SsoConnectionService;
      history: () => SsoConnectionHistoryService;
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
    const { states, total } = await this.deps.reads.findPage({ page, pageSize, search });
    const names = await this.organizationNames(states.map((state) => state.organizationId));

    return {
      connections: states.map((state) =>
        SsoConnectionBackofficeService.toBackofficeConnection({
          state,
          organizationName: names.get(state.organizationId) ?? null,
        }),
      ),
      total,
    };
  }

  async findById({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<BackofficeSsoConnection | null> {
    const state = await this.deps.reads.tryFindById({ connectionId });
    if (!state) {
      return null;
    }

    const names = await this.organizationNames([state.organizationId]);

    return SsoConnectionBackofficeService.toBackofficeConnection({
      state,
      organizationName: names.get(state.organizationId) ?? null,
    });
  }

  /**
   * One connection's raw history. The organization is resolved from the
   * connection rather than taken from the caller: this surface names a
   * connection, never a tenant.
   */
  async findHistory({
    connectionId,
    limit,
  }: {
    connectionId: string;
    limit?: number;
  }): Promise<SsoConnectionHistoryEntryView[] | null> {
    const state = await this.deps.reads.tryFindById({ connectionId });
    if (!state) {
      return null;
    }

    return this.deps.history().getHistory({
      organizationId: state.organizationId,
      connectionId,
      limit,
    });
  }

  /**
   * Register a connection for an organization. SAML is refused by name here rather than at the
   * aggregate: the aggregate is protocol-agnostic on purpose, and D09 will terminate SAML through
   * it.
   */
  async registerConnection({
    organizationId,
    type,
    providerId,
    issuer,
    allowsJit,
    arrivalPolicy,
    operator,
  }: {
    organizationId: string;
    type: string;
    providerId: string;
    issuer: string | null;
    /** The legacy boolean, read only when no policy was stated. */
    allowsJit: boolean;
    arrivalPolicy?: SsoArrivalPolicy;
    operator: OperatorActor;
  }): Promise<{ connectionId: string }> {
    if (type !== "oidc") {
      throw new SsoSamlNotSelfServeError(
        `connection type ${type} is not registrable through a self-serve surface`,
      );
    }

    const connectionId = newSsoConnectionId();
    await this.deps.connections().registerConnection({
      ...this.command({ organizationId, connectionId, operator }),
      type: "oidc",
      idp: {
        issuer,
        providerId,
        clientIdRef: null,
        secretRef: null,
        certRefs: [],
      },
      arrivalPolicy: arrivalPolicy ?? (allowsJit ? "admit" : "refuse"),
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

  async rejectDomainClaim(args: DomainCommandArgs & { note: string }): Promise<void> {
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

  async suspendConnection(args: ConnectionCommandArgs & { reason: string | null }): Promise<void> {
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
  private command({ organizationId, connectionId, operator }: ConnectionCommandArgs) {
    return {
      tenantId: organizationId,
      organizationId,
      connectionId,
      commandId: newSsoConnectionCommandId(),
      occurredAtMs: nowInstant().epochMilliseconds,
      actor: { type: "user" as const, id: operator.userId },
      source: "self-serve" as const,
    };
  }

  private organizationNames(organizationIds: string[]): Promise<Map<string, string>> {
    return this.deps.reads.findOrganizationNames({ organizationIds });
  }

  static toBackofficeConnection({
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
      domainVerifications: state.domainVerifications.map(
        ({ domain, method, actorId, verifiedAtMs }) => ({
          domain,
          method,
          actorId,
          verifiedAtMs,
        }),
      ),
      providerId: state.idpMetadata.providerId,
      issuer: state.idpMetadata.issuer,
      arrivalPolicy: state.arrivalPolicy,
      allowsJit: state.arrivalPolicy === "admit",
      source: state.source,
      testLoginAccountId: state.testLoginAccountId,
      rejection: state.rejection,
      // The ceremony's domain, never its token hash: a hash is a proof
      // artifact, and no operator reading a list has anything to do with one.
      pendingVerificationDomain: state.pendingVerification?.domain ?? null,
      pendingVerificationExpiresAtMs: state.pendingVerification?.expiresAtMs ?? null,
      createdAtMs: state.createdAtMs,
      updatedAtMs: state.updatedAtMs,
    };
  }
}

interface ConnectionCommandArgs {
  organizationId: string;
  connectionId: string;
  operator: OperatorActor;
}

type DomainCommandArgs = ConnectionCommandArgs & { domain: string };
