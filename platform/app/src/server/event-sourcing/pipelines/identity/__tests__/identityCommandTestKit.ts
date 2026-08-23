import { createTenantId } from "../../..";
import type { Command } from "../../../commands/command";
import type { IdentityGuardReads } from "../commands/identityGuardReads";
import {
  type IdentityFoldState,
  IdentityStateFoldProjection,
} from "../projections/identityState.foldProjection";
import type {
  IdentifierFact,
  IdentityLedgerState,
} from "../projections/reduceIdentity";
import type { IdentityEvent } from "../schemas/events";

/**
 * The shared harness for the per-command test files beside this one: one
 * guard-reads double, one command envelope, one fold helper — so every
 * command suite exercises the same contract surface rather than a drifted
 * copy.
 */

export const USER = "user_sam";
export const ACTOR = { type: "user" as const, id: USER };
export const T0 = 1_690_000_000_000;

export class InMemoryGuardReads implements IdentityGuardReads {
  hashKeys = new Map<string, string>();
  states = new Map<string, IdentityLedgerState>();
  activeByValue = new Map<string, { userId: string; identifierId: string }>();

  async getUserHashKey({ userId }: { userId: string }) {
    return this.hashKeys.get(userId) ?? null;
  }

  async findActiveIdentifierByValue({
    normalizedValue,
  }: {
    normalizedValue: string;
  }) {
    return this.activeByValue.get(normalizedValue) ?? null;
  }

  async loadIdentityState({ userId }: { userId: string }) {
    return this.states.get(userId) ?? { userId, identifiers: {} };
  }
}

export function command<T>(data: T): Command<T> {
  return {
    tenantId: createTenantId(USER),
    aggregateId: USER,
    type: "lw.identity.test",
    data,
  } as unknown as Command<T>;
}

export function attachData(overrides?: Record<string, unknown>) {
  return {
    tenantId: USER,
    userId: USER,
    commandId: "idcmd_1",
    accountId: "acc_1",
    provider: "google" as const,
    providerAccountId: "gid_123",
    value: "Sam.J+x@Acme.com",
    occurredAtMs: T0,
    ceremony: { flow: "oauth-callback" },
    actor: ACTOR,
    ...overrides,
  };
}

export function fact(overrides?: Partial<IdentifierFact>): IdentifierFact {
  return {
    identifierId: "idf_work",
    userId: USER,
    provider: "email",
    value: "sam@acme.com",
    domain: "acme.com",
    identifierHash: "hmac:abc",
    accountId: null,
    connectionId: null,
    state: "VERIFIED",
    verifiedAtMs: T0,
    attachedAtMs: T0,
    detachedAtMs: null,
    ...overrides,
  };
}

export function stateWith(...facts: IdentifierFact[]): IdentityLedgerState {
  return {
    userId: USER,
    identifiers: Object.fromEntries(facts.map((f) => [f.identifierId, f])),
  };
}

export function foldAll(events: IdentityEvent[]): IdentityFoldState {
  const projection = new IdentityStateFoldProjection({
    store: {
      load: async () => null,
      store: async () => void 0,
    },
  });
  return events.reduce(
    (state, event) => projection.apply(state, event),
    projection.init(),
  );
}
