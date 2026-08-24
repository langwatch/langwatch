import type {
  IdentifierFact,
  IdentityFact,
  IdentityFactOf,
  IdentityHeads,
} from "./facts";

/**
 * The pure identity reducer (ADR-101 §3). Live dispatch and the replay test
 * run this identical function — the app's fold projection validates the
 * wire event and hands it here, which is what makes replay determinism a
 * meaningful proof (the grants-ledger discipline, ADR-092 §13).
 *
 * Facts are accepted: the reducer never refuses, it folds. The guards that
 * can refuse (a PRIMARY detach, a uniqueness race) run before any fact
 * exists (`@langwatch/identity-server`'s IdentityGuards). A fact the heads
 * cannot apply cleanly (a verify for an unknown identifier — possible only
 * from a partial replay window) is folded conservatively rather than
 * dropped.
 */

function withFact(heads: IdentityHeads, fact: IdentifierFact): IdentityHeads {
  return {
    ...heads,
    identifiers: { ...heads.identifiers, [fact.identifierId]: fact },
  };
}

function applyAttached(
  heads: IdentityHeads,
  fact: IdentityFactOf<"lw.identity.identifier_attached">,
): IdentityHeads {
  const { data } = fact;
  // Idempotent re-application: the same fact (same deterministic id)
  // never regresses a later lifecycle state.
  if (heads.identifiers[data.identifierId]) return heads;
  return withFact(heads, {
    identifierId: data.identifierId,
    userId: data.userId,
    provider: data.provider,
    value: data.value,
    domain: data.domain,
    identifierHash: data.identifierHash,
    accountId: data.accountId,
    providerAccountId: data.providerAccountId,
    connectionId: data.connectionId,
    state: data.state,
    verifiedAtMs: data.state === "VERIFIED" ? fact.occurredAt : null,
    attachedAtMs: fact.occurredAt,
    detachedAtMs: null,
  });
}

function applyVerified(
  heads: IdentityHeads,
  fact: IdentityFactOf<"lw.identity.identifier_verified">,
): IdentityHeads {
  const head = heads.identifiers[fact.data.identifierId];
  // A tombstone or dead end never resurrects; PRIMARY stays PRIMARY.
  if (!head || (head.state !== "ATTACHED" && head.state !== "VERIFIED")) {
    return heads;
  }
  return withFact(heads, {
    ...head,
    state: head.state === "ATTACHED" ? "VERIFIED" : head.state,
    verifiedAtMs: head.verifiedAtMs ?? fact.occurredAt,
  });
}

function applyDeadEnded(
  heads: IdentityHeads,
  fact: IdentityFactOf<"lw.identity.identifier_dead_ended">,
): IdentityHeads {
  const head = heads.identifiers[fact.data.identifierId];
  if (head?.state !== "ATTACHED") return heads;
  return withFact(heads, { ...head, state: "DEAD_END" });
}

function applyPrimaryChanged(
  heads: IdentityHeads,
  fact: IdentityFactOf<"lw.identity.primary_changed">,
): IdentityHeads {
  const next = heads.identifiers[fact.data.identifierId];
  if (!next || (next.state !== "VERIFIED" && next.state !== "PRIMARY")) {
    return heads;
  }
  // Exactly one PRIMARY per user: demote every other holder, not just
  // the one the fact names — replay from a partial window could
  // otherwise leave two standing.
  const demoted = Object.values(heads.identifiers)
    .filter((head) => head.identifierId !== next.identifierId)
    .filter((head) => head.state === "PRIMARY")
    .map((head): IdentifierFact => ({ ...head, state: "VERIFIED" }));
  return [{ ...next, state: "PRIMARY" as const }, ...demoted].reduce(
    withFact,
    heads,
  );
}

function applyDetached(
  heads: IdentityHeads,
  fact: IdentityFactOf<"lw.identity.identifier_detached">,
): IdentityHeads {
  const head = heads.identifiers[fact.data.identifierId];
  if (!head || head.state === "DETACHED") return heads;
  return withFact(heads, {
    ...head,
    state: "DETACHED",
    detachedAtMs: fact.occurredAt,
  });
}

function applyUserErased(heads: IdentityHeads): IdentityHeads {
  // Erasure wipes values and hashes on every head (not only the ids the
  // fact names — the writer's list is the audit record, not the sweep's
  // bound, the member_offboarded discipline). Domains survive; the rows
  // remain as tombstones replay reproduces.
  return Object.values(heads.identifiers)
    .map(
      (head): IdentifierFact => ({
        ...head,
        value: null,
        identifierHash: null,
      }),
    )
    .reduce(withFact, heads);
}

export function reduceIdentity({
  heads,
  fact,
}: {
  heads: IdentityHeads;
  fact: IdentityFact;
}): IdentityHeads {
  switch (fact.type) {
    case "lw.identity.identifier_attached":
      return applyAttached(heads, fact);
    case "lw.identity.identifier_verified":
      return applyVerified(heads, fact);
    case "lw.identity.identifier_dead_ended":
      return applyDeadEnded(heads, fact);
    case "lw.identity.primary_changed":
      return applyPrimaryChanged(heads, fact);
    case "lw.identity.identifier_detached":
      return applyDetached(heads, fact);
    case "lw.identity.user_erased":
      return applyUserErased(heads);
  }
}
