import {
  type SsoConnectionLifecycleState,
  type SsoConnectionState,
  type SsoDomainVerification,
  SsoSamlNotSelfServeError,
} from "@langwatch/identity-contract";
import type { SsoConnectionService } from "../sso-connection.service";
import { newSsoConnectionCommandId, newSsoConnectionId } from "../sso-connection-id";
import type { SsoConnectionBackofficeRepository } from "../sso-connection-backoffice.repository";

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
  static create(deps: {
    reads: SsoConnectionBackofficeRepository;
    connections: () => SsoConnectionService;
  }): SsoConnectionBackofficeService {
    return new SsoConnectionBackofficeService(deps);
  }

  private constructor(
    private readonly deps: {
      reads: SsoConnectionBackofficeRepository;
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

  async getById({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<BackofficeSsoConnection | null> {
    const state = await this.deps.reads.findById({ connectionId });
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
    operator,
  }: {
    organizationId: string;
    type: string;
    providerId: string;
    issuer: string | null;
    allowsJit: boolean;
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
      occurredAtMs: Date.now(),
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
}

interface ConnectionCommandArgs {
  organizationId: string;
  connectionId: string;
  operator: OperatorActor;
}

type DomainCommandArgs = ConnectionCommandArgs & { domain: string };
