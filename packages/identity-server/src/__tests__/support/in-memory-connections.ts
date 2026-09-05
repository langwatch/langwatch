import {
  emptySsoConnection,
  reduceSsoConnection,
  type SsoConnectionFactInput,
  type SsoConnectionState,
} from "@langwatch/identity";
import type {
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
  SsoLicenseAuthorityRepository,
  SsoPlatformOperatorRepository,
} from "../../sso-connection.repository";

/**
 * The connection guards' three reads, in memory — and, deliberately, the SAME
 * reducer the projection folds with. A test double that maintained its own
 * idea of what an event does to a connection would let a guard pass against
 * a state the real projection never produces.
 */
export class InMemoryConnections implements SsoConnectionReadRepository {
  private readonly states = new Map<string, SsoConnectionState>();

  async findConnection({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<SsoConnectionState | null> {
    return this.states.get(connectionId) ?? null;
  }

  async findDomainOwner({
    domain,
  }: {
    domain: string;
  }): Promise<{ connectionId: string; organizationId: string } | null> {
    for (const state of this.states.values()) {
      if (state.state === "ACTIVE" && state.verifiedDomains.includes(domain)) {
        return {
          connectionId: state.connectionId,
          organizationId: state.organizationId,
        };
      }
    }
    return null;
  }

  /**
   * The one connection an organization is setting up or running. Terminal
   * states are excluded, exactly as the Prisma read does — a torn-down
   * connection is a tombstone rather than a setup in progress.
   */
  async findConnectionForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SsoConnectionState | null> {
    for (const state of this.states.values()) {
      if (state.organizationId !== organizationId) continue;
      if (state.state === "DISCARDED" || state.state === "TORN_DOWN") continue;
      return state;
    }
    return null;
  }

  /** Fold facts in, exactly as the projection would. */
  apply({
    connectionId,
    facts,
    occurredAt,
  }: {
    connectionId: string;
    facts: SsoConnectionFactInput[];
    occurredAt: number;
  }): SsoConnectionState {
    let state =
      this.states.get(connectionId) ?? emptySsoConnection({ connectionId });
    for (const fact of facts) {
      state = reduceSsoConnection({ state, fact: { ...fact, occurredAt } });
    }
    this.states.set(connectionId, state);
    return state;
  }

  /** Every connection this store holds — what a cross-organization read,
   *  such as the tier-3 claim queue, scans. */
  all(): readonly SsoConnectionState[] {
    return [...this.states.values()];
  }

  /** Put a connection into a state directly, for a precondition a test does
   *  not want to spell out event by event. */
  seed(state: SsoConnectionState): void {
    this.states.set(state.connectionId, state);
  }
}

export class StubBreakGlassBindings implements SsoBreakGlassBindingRepository {
  constructor(private live: boolean) {}

  async hasLiveBinding(): Promise<boolean> {
    return this.live;
  }

  set(live: boolean): void {
    this.live = live;
  }
}

/**
 * Which actors this deployment counts as LangWatch platform operators. A set
 * of ids rather than a boolean, so a test can hold an operator and an
 * organization administrator at once — which is the shape every scenario
 * about who may attest a domain actually needs.
 */
export class StubPlatformOperators implements SsoPlatformOperatorRepository {
  private readonly operators: Set<string>;

  constructor(operatorIds: string[] = []) {
    this.operators = new Set(operatorIds);
  }

  async isPlatformOperator({ actorId }: { actorId: string }): Promise<boolean> {
    return this.operators.has(actorId);
  }
}

/**
 * Whether the installation's licence may authorize a domain claim (D05 tier
 * 2). A boolean rather than a set, because a licence speaks for an
 * INSTALLATION and not for a person — which is the whole reason a hosted
 * organization can never reach the licence-bound path.
 */
export class StubLicenseAuthority implements SsoLicenseAuthorityRepository {
  constructor(private licensed = false) {}

  async licenseAuthorizesDomainClaims(): Promise<boolean> {
    return this.licensed;
  }

  set(licensed: boolean): void {
    this.licensed = licensed;
  }
}

export class StubStranding implements SsoConnectionStrandingRepository {
  constructor(private userIds: string[] = []) {}

  async findStrandedUserIds(): Promise<string[]> {
    return this.userIds;
  }

  set(userIds: string[]): void {
    this.userIds = userIds;
  }
}
