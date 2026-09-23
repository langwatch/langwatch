import {
  emptySsoConnection,
  reduceSsoConnection,
  type SsoConnectionFactInput,
  type SsoConnectionState,
} from "@langwatch/identity-contract";

import type {
  SsoConnectionRegistrationRepository,
  SsoConnectionRegistrationSlot,
} from "../../repositories/sso-connection-registration.repository.ts";
import type {
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
  SsoPlatformOperatorRepository,
} from "../../repositories/sso-connection.repository.ts";
import { findBlockingRegistrationSlots } from "../../rules/sso-connection-registration.rules.ts";
import { ownedVerifiedDomains } from "../../rules/sso-domain-ownership.rules.ts";

/**
 * The connection guards' three reads, in memory — using the SAME reducer the
 * projection folds with, so a guard can never pass against a state the real
 * projection never produces.
 */
export class InMemoryConnections
  implements SsoConnectionReadRepository, SsoConnectionRegistrationRepository
{
  private readonly states = new Map<string, SsoConnectionState>();
  private readonly registrationSlots = new Map<string, SsoConnectionRegistrationSlot>();

  /** The registration lock, by the same rule the Postgres twin applies. */
  async claim(candidate: SsoConnectionRegistrationSlot): Promise<SsoConnectionRegistrationSlot> {
    const slots = [...this.registrationSlots.values()].filter(
      (slot) => slot.organizationId === candidate.organizationId,
    );
    const stateByConnection = new Map(
      [...this.states.values()].map((state) => [state.connectionId, state.state]),
    );
    const [blocking] = findBlockingRegistrationSlots({ candidate, slots, stateByConnection });
    if (blocking) return blocking;
    this.registrationSlots.set(`${candidate.organizationId}:${candidate.kind}`, candidate);
    return candidate;
  }

  async tryFindConnection({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<SsoConnectionState | null> {
    return this.states.get(connectionId) ?? null;
  }

  async tryFindDomainOwner({
    domain,
  }: {
    domain: string;
  }): Promise<{ connectionId: string; organizationId: string } | null> {
    const holders = [...this.states.values()].filter((state) =>
      ownedVerifiedDomains(state).includes(domain),
    );
    const owner = holders.find((state) => state.replacesConnectionId === null) ?? holders[0];
    return owner
      ? { connectionId: owner.connectionId, organizationId: owner.organizationId }
      : null;
  }

  async findForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SsoConnectionState[]> {
    return [...this.states.values()]
      .filter((state) => state.organizationId === organizationId)
      .toSorted((left, right) => right.createdAtMs - left.createdAtMs);
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
    let state = this.states.get(connectionId) ?? emptySsoConnection({ connectionId });
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

  async reserveActivationRecovery(): Promise<boolean> {
    return this.live;
  }

  set(live: boolean): void {
    this.live = live;
  }
}

/**
 * Which actors this deployment counts as LangWatch platform operators. A set
 * of ids, not a boolean, so a test can hold an operator and an
 * organization administrator at once.
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

export class StubStranding implements SsoConnectionStrandingRepository {
  constructor(private userIds: string[] = []) {}

  async findStrandedUserIds(): Promise<string[]> {
    return this.userIds;
  }

  set(userIds: string[]): void {
    this.userIds = userIds;
  }
}
