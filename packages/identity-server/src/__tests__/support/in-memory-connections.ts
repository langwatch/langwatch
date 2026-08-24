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

export class StubStranding implements SsoConnectionStrandingRepository {
  constructor(private userIds: string[] = []) {}

  async findStrandedUserIds(): Promise<string[]> {
    return this.userIds;
  }

  set(userIds: string[]): void {
    this.userIds = userIds;
  }
}
