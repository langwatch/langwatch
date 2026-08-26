import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  type IdentifierFact,
  type IdentityFact,
  type IdentityFactInput,
  type IdentityFactInputOf,
  type IdentityHeads,
  PRIMARY_CHANGED_EVENT_TYPE,
  USER_ERASED_EVENT_TYPE,
} from "./facts";
import type { IdentityActor } from "./vocabulary";

/**
 * An identifier is an aggregate (ADR-127), which is ADR-110's move one domain
 * over: the person is the TENANT of every identity fact and the aggregate of
 * nothing but what is genuinely about the person.
 *
 * Two things travelled together in the shared per-user stream, and only one of
 * them is being given up.
 *
 *   SERIALISATION. The queue keys its lane on the aggregate id, so every
 *   ceremony a person could run held one lane. Splitting the streams is what
 *   ends that, on purpose.
 *
 *   TWO CROSS-IDENTIFIER SWEEPS the reducer performed over state a
 *   per-identifier fold cannot see: a promotion demoting every standing
 *   PRIMARY, and an erasure wiping every head rather than the ids the writer
 *   listed. Those are invariants, not conveniences, and they survive here by
 *   being ROUTED instead of swept — the command reads the whole person (a
 *   filter over the projection, ADR-110's answer to the same problem in
 *   offboarding) and states one fact per stream that has to move.
 *
 * So the FOLD RULE is unchanged in both cases; what changes is who is handed
 * the fact. `reduceIdentity` hands every fact to every head, which is what it
 * always did. A per-identifier fold hands each stream only the facts
 * `identityStreamsFor` routes to it. On the facts a command states, the two
 * agree — which is what lets the aggregate move without the reducer moving.
 */

/** One identifier's head as its own stream folds it: the row, or no row. */
export type IdentifierHead = IdentifierFact | null;

/**
 * The aggregate ids a fact is stated on — the routing table, and the whole
 * decision in one function.
 *
 * A fact about an identifier goes to that identifier. A fact about the PERSON
 * — a link proposal, which states that no identifier arrived, and the erasure
 * record — goes to the person's own stream, which is also where two-step
 * verification lives (D06). An erasure goes to both: the person's stream keeps
 * the record even for somebody holding nothing, and each named identifier's
 * stream is where the wipe actually lands.
 *
 * The aggregate TYPE does not appear here and does not change. It is the event
 * store's partition key and the store rejects an event whose type differs from
 * its pipeline's declared one, so `user_identity` stays what it is on a log
 * that already carries live events — exactly as `authz_grant` carries both
 * grants and roles (ADR-110). What names the entity is the aggregate ID.
 */
export function identityStreamsFor({
  fact,
  userId,
}: {
  fact: IdentityFactInput;
  userId: string;
}): string[] {
  switch (fact.type) {
    case "lw.identity.identifier_attached":
    case "lw.identity.identifier_verified":
    case "lw.identity.identifier_dead_ended":
    case "lw.identity.identifier_detached":
      return [fact.data.identifierId];
    case PRIMARY_CHANGED_EVENT_TYPE:
      return fact.data.previousIdentifierId === null
        ? [fact.data.identifierId]
        : [fact.data.identifierId, fact.data.previousIdentifierId];
    case USER_ERASED_EVENT_TYPE:
      return [userId, ...fact.data.erasedIdentifierIds];
    case "lw.identity.link_proposed":
      return [userId];
  }
}

/**
 * One identifier's head, folded by one fact — the per-aggregate reducer.
 *
 * Total and conservative in the same way the per-user reducer is: a fact this
 * head cannot apply cleanly leaves it alone rather than throwing, because a
 * partial replay window is a normal thing to fold. It never refuses — the
 * guards that refuse run before any fact exists.
 */
export function reduceIdentifier({
  identifierId,
  head,
  fact,
}: {
  identifierId: string;
  head: IdentifierHead;
  fact: IdentityFact;
}): IdentifierHead {
  switch (fact.type) {
    case IDENTIFIER_ATTACHED_EVENT_TYPE: {
      if (fact.data.identifierId !== identifierId) return head;
      // Idempotent re-application: the same fact (same deterministic id)
      // never regresses a later lifecycle state.
      if (head) return head;
      const { data } = fact;
      return {
        identifierId: data.identifierId,
        userId: data.userId,
        provider: data.provider,
        value: data.value,
        domain: data.domain,
        identifierHash: data.identifierHash,
        accountId: data.accountId,
        providerId: data.providerId,
        issuer: data.issuer,
        providerAccountId: data.providerAccountId,
        connectionId: data.connectionId,
        state: data.state,
        verifiedAtMs: data.state === "VERIFIED" ? fact.occurredAt : null,
        attachedAtMs: fact.occurredAt,
        detachedAtMs: null,
      };
    }
    case "lw.identity.identifier_verified": {
      if (fact.data.identifierId !== identifierId || !head) return head;
      // A tombstone or dead end never resurrects; PRIMARY stays PRIMARY.
      if (head.state !== "ATTACHED" && head.state !== "VERIFIED") return head;
      return {
        ...head,
        state: head.state === "ATTACHED" ? "VERIFIED" : head.state,
        verifiedAtMs: head.verifiedAtMs ?? fact.occurredAt,
      };
    }
    case "lw.identity.identifier_dead_ended": {
      if (fact.data.identifierId !== identifierId || !head) return head;
      if (head.state !== "ATTACHED") return head;
      return { ...head, state: "DEAD_END" };
    }
    case PRIMARY_CHANGED_EVENT_TYPE: {
      if (!head) return head;
      // The promoted half. Ineligible states are left alone, which is what
      // makes a partial-window replay harmless.
      if (fact.data.identifierId === identifierId) {
        if (head.state !== "VERIFIED" && head.state !== "PRIMARY") return head;
        return { ...head, state: "PRIMARY" };
      }
      // The demoted half: a promotion of somebody else, delivered to a head
      // that is standing PRIMARY. Exactly one PRIMARY per person is the
      // invariant, and this is the half of it a stream can enforce on its
      // own — the other half is `primaryChangeFacts` naming who to deliver to.
      if (head.state !== "PRIMARY") return head;
      return { ...head, state: "VERIFIED" };
    }
    case "lw.identity.identifier_detached": {
      if (fact.data.identifierId !== identifierId || !head) return head;
      if (head.state === "DETACHED") return head;
      return { ...head, state: "DETACHED", detachedAtMs: fact.occurredAt };
    }
    case USER_ERASED_EVENT_TYPE: {
      // Erasure wipes the value and the hash and keeps everything else: the
      // row, the domain (an org-level fact), the state and the dates. It is
      // delivered to the streams the erasure names, and the names come from a
      // read of the whole person.
      if (!head) return head;
      return { ...head, value: null, identifierHash: null };
    }
    case "lw.identity.link_proposed":
      // A proposal changes no head, on purpose: it states that a link was NOT
      // made and needs a human.
      return head;
  }
}

/**
 * The facts a primary change states — one per stream that has to move.
 *
 * The demotion used to be the fold's: it swept every head and demoted whatever
 * it found standing. A per-identifier fold has no such view, so the sweep moves
 * here, to the moment a command can still read the whole person. Normally that
 * is one demotion or none; more than one is only reachable when a partial
 * replay left two standing, and naming all of them is what keeps "exactly one
 * PRIMARY" true rather than approximately true.
 *
 * The caller has already refused an ineligible promotion (`markPrimary`), so a
 * demotion only ever exists alongside a promotion that took.
 */
export function primaryChangeFacts({
  heads,
  identifierId,
  actor,
}: {
  heads: IdentityHeads;
  identifierId: string;
  actor: IdentityActor;
}): IdentityFactInputOf<typeof PRIMARY_CHANGED_EVENT_TYPE>[] {
  const standing = Object.values(heads.identifiers)
    .filter((head) => head.state === "PRIMARY")
    .filter((head) => head.identifierId !== identifierId)
    .map((head) => head.identifierId);
  if (standing.length === 0) {
    return [
      {
        type: PRIMARY_CHANGED_EVENT_TYPE,
        data: { identifierId, previousIdentifierId: null, actor },
      },
    ];
  }
  return standing.map((previousIdentifierId) => ({
    type: PRIMARY_CHANGED_EVENT_TYPE,
    data: { identifierId, previousIdentifierId, actor },
  }));
}

/**
 * The erasure fact, naming every identifier the person holds.
 *
 * The list is the sweep's bound now, where it used to be the writer's audit
 * record — so it has to be a read of the WHOLE person rather than the ids a
 * caller happened to pass, which is ADR-110's principal-filter rule in
 * identity's terms. `heads` is that read: every row the projection holds for
 * this user, tombstones included, because a tombstone still carries the value
 * erasure exists to remove.
 */
export function userErasureFacts({
  heads,
  userId,
  actor,
}: {
  heads: IdentityHeads;
  userId: string;
  actor: IdentityActor;
}): IdentityFactInputOf<typeof USER_ERASED_EVENT_TYPE>[] {
  return [
    {
      type: USER_ERASED_EVENT_TYPE,
      data: {
        userId,
        erasedIdentifierIds: Object.keys(heads.identifiers),
        actor,
      },
    },
  ];
}
