import type { IdentifierProvider, IdentityEvent } from "../schemas/events";

/**
 * The pure identity reducer (ADR-101 §3). Live dispatch and the replay test
 * run this identical function — the fold projection validates the wire event
 * and hands it here, which is what makes replay determinism a meaningful
 * proof (the grants-ledger discipline, ADR-092 §13).
 *
 * Events are accepted facts: the reducer never refuses, it folds. The
 * guards that can refuse (a PRIMARY detach, a uniqueness race) live in the
 * command handlers, before any event exists. An event the state cannot
 * apply cleanly (a verify for an unknown identifier — possible only from a
 * partial replay window) is folded conservatively rather than dropped.
 */

export type IdentifierLifecycleState =
  | "ATTACHED"
  | "VERIFIED"
  | "PRIMARY"
  | "DEAD_END"
  | "DETACHED";

export interface IdentifierFact {
  identifierId: string;
  userId: string;
  provider: IdentifierProvider;
  /** Normalized value; null once erased. */
  value: string | null;
  /** Org-level fact; survives erasure. */
  domain: string | null;
  /** `hmac:`-prefixed; null once erased or when no key existed at attach. */
  identifierHash: string | null;
  accountId: string | null;
  connectionId: string | null;
  state: IdentifierLifecycleState;
  verifiedAtMs: number | null;
  attachedAtMs: number;
  detachedAtMs: number | null;
}

export interface IdentityLedgerState {
  userId: string;
  identifiers: Record<string, IdentifierFact>;
}

export function emptyIdentityState({
  userId,
}: {
  userId: string;
}): IdentityLedgerState {
  return { userId, identifiers: {} };
}

function withFact(
  state: IdentityLedgerState,
  fact: IdentifierFact,
): IdentityLedgerState {
  return {
    ...state,
    identifiers: { ...state.identifiers, [fact.identifierId]: fact },
  };
}

export function reduceIdentity({
  state,
  event,
}: {
  state: IdentityLedgerState;
  event: IdentityEvent;
}): IdentityLedgerState {
  switch (event.type) {
    case "lw.identity.identifier_attached": {
      const { data } = event;
      const existing = state.identifiers[data.identifierId];
      // Idempotent re-application: the same fact (same deterministic id)
      // never regresses a later lifecycle state.
      if (existing) return state;
      return withFact(state, {
        identifierId: data.identifierId,
        userId: data.userId,
        provider: data.provider,
        value: data.email,
        domain: data.domain,
        identifierHash: data.identifierHash,
        accountId: data.accountId,
        connectionId: data.connectionId,
        state: data.state,
        verifiedAtMs: data.state === "VERIFIED" ? event.occurredAt : null,
        attachedAtMs: event.occurredAt,
        detachedAtMs: null,
      });
    }
    case "lw.identity.identifier_verified": {
      const fact = state.identifiers[event.data.identifierId];
      if (!fact) return state;
      // A tombstone or dead end never resurrects; PRIMARY stays PRIMARY.
      if (fact.state !== "ATTACHED" && fact.state !== "VERIFIED") return state;
      return withFact(state, {
        ...fact,
        state: fact.state === "ATTACHED" ? "VERIFIED" : fact.state,
        verifiedAtMs: fact.verifiedAtMs ?? event.occurredAt,
      });
    }
    case "lw.identity.identifier_dead_ended": {
      const fact = state.identifiers[event.data.identifierId];
      if (!fact) return state;
      if (fact.state !== "ATTACHED") return state;
      return withFact(state, { ...fact, state: "DEAD_END" });
    }
    case "lw.identity.primary_changed": {
      const next = state.identifiers[event.data.identifierId];
      if (!next || (next.state !== "VERIFIED" && next.state !== "PRIMARY")) {
        return state;
      }
      let result = withFact(state, { ...next, state: "PRIMARY" });
      // Exactly one PRIMARY per user: demote every other holder, not just
      // the one the event names — replay from a partial window could
      // otherwise leave two standing.
      for (const fact of Object.values(result.identifiers)) {
        if (
          fact.identifierId !== event.data.identifierId &&
          fact.state === "PRIMARY"
        ) {
          result = withFact(result, { ...fact, state: "VERIFIED" });
        }
      }
      return result;
    }
    case "lw.identity.identifier_detached": {
      const fact = state.identifiers[event.data.identifierId];
      if (!fact) return state;
      if (fact.state === "DETACHED") return state;
      return withFact(state, {
        ...fact,
        state: "DETACHED",
        detachedAtMs: event.occurredAt,
      });
    }
    case "lw.identity.user_erased": {
      // Erasure wipes values and hashes on every fact (not only the ids the
      // event names — the writer's list is the audit record, not the sweep's
      // bound, the member_offboarded discipline). Domains survive; the rows
      // remain as tombstones replay reproduces.
      let result = state;
      for (const fact of Object.values(state.identifiers)) {
        result = withFact(result, {
          ...fact,
          value: null,
          identifierHash: null,
        });
      }
      return result;
    }
  }
}
