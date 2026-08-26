import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  type IdentifierFact,
  type IdentityFact,
  type IdentityHeads,
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
 * The fold RULES live one file over, in `reduceIdentifier`, which folds a
 * single identifier's head (ADR-127: an identifier is an aggregate). What is
 * left here is DELIVERY — which heads are handed a given fact — and that is
 * the only thing the aggregate split changes:
 *
 *   here                      a per-identifier fold
 *   ─────────────────────     ──────────────────────────────────────
 *   every head, always        only the streams `identityStreamsFor`
 *                             routes the fact to
 *
 * Two deliveries are wider than the fact's own identifier, and they are the
 * two cross-identifier invariants the shared stream used to enforce: a
 * promotion reaches every other head, so exactly one PRIMARY stands, and an
 * erasure reaches every head rather than the ids the writer listed. Under
 * per-identifier aggregates neither sweep is possible, so both move into the
 * facts a command states (`primaryChangeFacts`, `userErasureFacts`) — the
 * rules below do not move, and that is what lets the two reducers agree.
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
    if (folded === head || folded === null) continue;
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
    case "lw.identity.identifier_verified":
    case "lw.identity.identifier_dead_ended":
    case "lw.identity.identifier_detached":
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
      // Every head, not only the ids the fact names — the writer's list is
      // the audit record, not the sweep's bound (the member_offboarded
      // discipline). Domains survive; the rows remain as tombstones replay
      // reproduces.
      return deliver({
        heads,
        identifierIds: Object.keys(heads.identifiers),
        fact,
      });
    case "lw.identity.link_proposed":
      // A proposal changes no head, on purpose: it states that a link was NOT
      // made and needs a human. The identifier arrives only when someone
      // confirms it, through the ordinary attach ceremony — so a fold that
      // moved a head here would be the auto-link the proposal exists to
      // refuse.
      return heads;
  }
}
