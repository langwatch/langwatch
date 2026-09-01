import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IDENTIFIER_DETACHED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
  type IdentifierFact,
  type IdentityFact,
  type IdentityHeads,
  LINK_PROPOSED_EVENT_TYPE,
  PRIMARY_CHANGED_EVENT_TYPE,
  USER_ERASED_EVENT_TYPE,
} from "./facts";
import { reduceIdentifier } from "./identifier-aggregate";

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
 *
 * The RULES live one file over, in `reduceIdentifier` (ADR-127: an identifier
 * is an aggregate). What is left here is DELIVERY — which heads are handed a
 * given fact — and today that is every head, always. Two of those deliveries
 * are wider than the fact's own identifier, and they are the two invariants a
 * per-identifier fold cannot hold: a promotion reaches every other head so
 * exactly one PRIMARY stands, and an erasure reaches every head rather than
 * only the ids the fact names. Both move into the facts a command states when
 * the fold splits; until then, this is what runs, and it is what ran before
 * the rules moved files.
 */

function deliver({
  heads,
  identifierIds,
  fact,
}: {
  heads: IdentityHeads;
  identifierIds: string[];
  fact: IdentityFact;
}): IdentityHeads {
  let identifiers: Record<string, IdentifierFact> = heads.identifiers;
  for (const identifierId of identifierIds) {
    const head = identifiers[identifierId] ?? null;
    const folded = reduceIdentifier({ identifierId, head, fact });
    if (folded === head) continue;
    // No identity fact deletes a head — a detach is a tombstone, an erasure
    // keeps the row — so `reduceIdentifier` returns null only for a head that
    // was already absent, which the line above has caught. The day one does,
    // this is the line that has to delete the key rather than skip it.
    if (folded === null) continue;
    identifiers = { ...identifiers, [identifierId]: folded };
  }
  return identifiers === heads.identifiers ? heads : { ...heads, identifiers };
}

export function reduceIdentity({
  heads,
  fact,
}: {
  heads: IdentityHeads;
  fact: IdentityFact;
}): IdentityHeads {
  switch (fact.type) {
    case IDENTIFIER_ATTACHED_EVENT_TYPE:
    case IDENTIFIER_VERIFIED_EVENT_TYPE:
    case IDENTIFIER_DEAD_ENDED_EVENT_TYPE:
    case IDENTIFIER_DETACHED_EVENT_TYPE:
      return deliver({
        heads,
        identifierIds: [fact.data.identifierId],
        fact,
      });
    case PRIMARY_CHANGED_EVENT_TYPE: {
      const { identifierId } = fact.data;
      // The promotion first, because the demotions are conditional on it: a
      // fact naming a head that cannot take PRIMARY moves nothing at all,
      // which is what stops a partial-window replay leaving a person with no
      // PRIMARY where they had one.
      const promoted = deliver({ heads, identifierIds: [identifierId], fact });
      if (promoted.identifiers[identifierId]?.state !== "PRIMARY") return heads;
      // Every OTHER holder, not only the one the fact names — the sweep a
      // per-identifier fold gives up and `primaryChangeFacts` takes over.
      return deliver({
        heads: promoted,
        identifierIds: Object.keys(promoted.identifiers).filter(
          (candidate) => candidate !== identifierId,
        ),
        fact,
      });
    }
    case USER_ERASED_EVENT_TYPE:
      // Every head, not only the ids the fact names: today the list on the
      // fact is the writer's audit record and this delivery is the sweep's
      // bound (the member_offboarded discipline). Under a per-identifier fold
      // there is no such delivery and the list becomes the bound, which is why
      // `userErasureFacts` reads the whole person to build it. Domains survive;
      // the rows remain as tombstones replay reproduces.
      return deliver({
        heads,
        identifierIds: Object.keys(heads.identifiers),
        fact,
      });
    case LINK_PROPOSED_EVENT_TYPE:
      // A proposal changes no head, on purpose: it states that a link was NOT
      // made and needs a human. The identifier arrives only when someone
      // confirms it, through the ordinary attach ceremony — so a fold that
      // moved a head here would be the auto-link the proposal exists to
      // refuse.
      return heads;
  }
}
