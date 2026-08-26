import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IDENTIFIER_DETACHED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
  type IdentifierFact,
  type IdentityFact,
  type IdentityFactInput,
  type IdentityFactInputOf,
  type IdentityHeads,
  LINK_PROPOSED_EVENT_TYPE,
  PRIMARY_CHANGED_EVENT_TYPE,
  USER_ERASED_EVENT_TYPE,
} from "./facts";
import type { IdentityActor } from "./vocabulary";

/**
 * An identifier is an aggregate — the rules one identifier's own stream folds
 * by, and the table that says which stream a fact is stated on.
 *
 * The reasoning is ADR-127; it is not repeated here. What this file owns is the
 * two things the reasoning turns into code: `identityStreamsFor`, and a fold
 * that can see one head and no more.
 */

/**
 * A stream a fact is stated on. Discriminated rather than a bare id, because
 * the two kinds are folded by different things: an identifier's stream folds
 * with `reduceIdentifier`, and the person's folds two-step verification and
 * nothing about identifiers. They are both KSUIDs, so nothing but this type
 * stops a caller handing a user id to a per-identifier fold.
 */
export type IdentityStream =
  | { kind: "identifier"; identifierId: string }
  | { kind: "person"; userId: string };

/** One identifier's head as its own stream folds it: the row, or no row. */
export type IdentifierHead = IdentifierFact | null;

/**
 * The streams a fact is stated on — the routing table, and the whole decision
 * in one function.
 *
 * A fact about an identifier goes to that identifier. A fact about the PERSON —
 * a link proposal, which states that no identifier arrived, and the erasure
 * record — goes to the person's own stream, which is also where two-step
 * verification lives (D06). An erasure goes to both: the person's stream keeps
 * the record even for somebody holding nothing, and each named identifier's
 * stream is where the wipe lands.
 *
 * **One event per returned stream.** An event carries exactly one aggregate id,
 * so a fact that routes to N streams is appended as N events: the same payload,
 * N distinct aggregate ids, N distinct `<commandId>:<index>` idempotency keys.
 * A promotion that demotes somebody is therefore two events, and an erasure for
 * a person holding three identifiers is four. An implementation that picked one
 * of the returned streams instead would reproduce, on new events, exactly the
 * gap ADR-127 records for legacy ones.
 *
 * The aggregate TYPE is not decided here and does not change. It is the event
 * store's partition key and the store rejects an event whose type differs from
 * its pipeline's declared one, so `user_identity` stays what it is on a log
 * that already carries live events. The aggregate ID is checked by nothing,
 * which is what leaves it free to name the entity — the authz pipeline tells
 * grants and roles apart the same way, under one declared type.
 */
export function identityStreamsFor({
  fact,
  userId,
}: {
  fact: IdentityFactInput;
  userId: string;
}): IdentityStream[] {
  switch (fact.type) {
    case IDENTIFIER_ATTACHED_EVENT_TYPE:
    case IDENTIFIER_VERIFIED_EVENT_TYPE:
    case IDENTIFIER_DEAD_ENDED_EVENT_TYPE:
    case IDENTIFIER_DETACHED_EVENT_TYPE:
      return [{ kind: "identifier", identifierId: fact.data.identifierId }];
    case PRIMARY_CHANGED_EVENT_TYPE:
      return identifierStreams([
        fact.data.identifierId,
        // Null on a first promotion. Equal to the promoted id only in a fact
        // no command states (`primaryChangeFacts` excludes the identifier
        // being promoted), so the dedupe below is for a malformed one.
        ...(fact.data.previousIdentifierId === null
          ? []
          : [fact.data.previousIdentifierId]),
      ]);
    case USER_ERASED_EVENT_TYPE:
      return [
        { kind: "person", userId },
        ...identifierStreams(fact.data.erasedIdentifierIds),
      ];
    case LINK_PROPOSED_EVENT_TYPE:
      return [{ kind: "person", userId }];
  }
}

function identifierStreams(identifierIds: string[]): IdentityStream[] {
  return [...new Set(identifierIds)].map((identifierId) => ({
    kind: "identifier" as const,
    identifierId,
  }));
}

/**
 * One identifier's head, folded by one fact — the per-aggregate reducer.
 *
 * Total and conservative in the same way the per-user reducer is: a fact this
 * head cannot apply cleanly leaves it alone rather than throwing, because a
 * partial replay window is a normal thing to fold. It never refuses — the
 * guards that refuse run before any fact exists.
 *
 * It sees ONE head, which is the point and also the limit. A promotion demotes
 * this head if this head is standing PRIMARY, and cannot check whether the
 * promotion it names took: ADR-127 §"What one head cannot see" records the two
 * histories where that makes it disagree with the per-person fold, and both are
 * reachable only from a partial replay window.
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
    case IDENTIFIER_VERIFIED_EVENT_TYPE: {
      if (fact.data.identifierId !== identifierId || !head) return head;
      // A tombstone or dead end never resurrects; PRIMARY stays PRIMARY.
      if (head.state !== "ATTACHED" && head.state !== "VERIFIED") return head;
      return {
        ...head,
        state: head.state === "ATTACHED" ? "VERIFIED" : head.state,
        verifiedAtMs: head.verifiedAtMs ?? fact.occurredAt,
      };
    }
    case IDENTIFIER_DEAD_ENDED_EVENT_TYPE: {
      if (fact.data.identifierId !== identifierId || !head) return head;
      if (head.state !== "ATTACHED") return head;
      return { ...head, state: "DEAD_END" };
    }
    case PRIMARY_CHANGED_EVENT_TYPE: {
      if (!head) return head;
      // The promoted half. A head that cannot take PRIMARY is left alone,
      // so a fact naming a tombstone or a dead end moves nothing.
      if (fact.data.identifierId === identifierId) {
        if (head.state !== "VERIFIED" && head.state !== "PRIMARY") return head;
        return { ...head, state: "PRIMARY" };
      }
      // The demoted half: a promotion of somebody else, delivered to a head
      // standing PRIMARY. Exactly one PRIMARY per person is the invariant, and
      // this is the half of it a stream can enforce alone — the other half is
      // `primaryChangeFacts` naming every stream that has to be told.
      if (head.state !== "PRIMARY") return head;
      return { ...head, state: "VERIFIED" };
    }
    case IDENTIFIER_DETACHED_EVENT_TYPE: {
      if (fact.data.identifierId !== identifierId || !head) return head;
      if (head.state === "DETACHED") return head;
      return { ...head, state: "DETACHED", detachedAtMs: fact.occurredAt };
    }
    case USER_ERASED_EVENT_TYPE: {
      // Erasure wipes the value and the hash and keeps everything else: the
      // row, the domain (an org-level fact), the state and the dates.
      if (!head) return head;
      return { ...head, value: null, identifierHash: null };
    }
    case LINK_PROPOSED_EVENT_TYPE:
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
 * Today the fold ignores that list and wipes every head it has, so the list is
 * the writer's audit record. Once the fold keys per identifier (ADR-127 slice 3)
 * the list becomes the sweep's BOUND — nothing else says which streams the wipe
 * reaches — which is why it has to be a read of the WHOLE person rather than the
 * ids a caller passed. `heads` is that read: every row the projection holds for
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
