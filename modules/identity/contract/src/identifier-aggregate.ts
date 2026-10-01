import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IDENTIFIER_DETACHED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
  type IdentifierFact,
  type IdentityFact,
  type IdentityFactInput,
  type IdentityFactInputOf,
  type IdentityFactOf,
  type IdentityHeads,
  LINK_CONFIRMED_EVENT_TYPE,
  LINK_PROPOSED_EVENT_TYPE,
  LINK_REJECTED_EVENT_TYPE,
  PRIMARY_CHANGED_EVENT_TYPE,
  USER_ERASED_EVENT_TYPE,
} from "./facts.ts";
import type { IdentityActor } from "./vocabulary.ts";

/**
 * An identifier is an aggregate — the rules one identifier's own stream folds
 * by, and which stream a fact is stated on. Reasoning: ADR-127, not repeated
 * here. This file owns `identityStreamsFor`, and a fold seeing one head only.
 */

/**
 * A stream a fact is stated on. Discriminated, not a bare id: both kinds are
 * KSUIDs, so nothing but this type stops a caller handing a user id to a
 * per-identifier fold.
 */
export type IdentityStream =
  | { kind: "identifier"; identifierId: string }
  | { kind: "person"; userId: string };

/** One identifier's head as its own stream folds it: the row, or no row. */
export type IdentifierHead = IdentifierFact | null;

/** Routes a fact to its target streams: identifier facts to the identifier stream, person facts to
 * the person stream. See ADR-127 for event idempotency and per-aggregate fold design.
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
        ...(fact.data.previousIdentifierId === null ? [] : [fact.data.previousIdentifierId]),
      ]);
    case USER_ERASED_EVENT_TYPE:
      return [{ kind: "person", userId }, ...identifierStreams(fact.data.erasedIdentifierIds)];
    case LINK_PROPOSED_EVENT_TYPE:
    case LINK_CONFIRMED_EVENT_TYPE:
    case LINK_REJECTED_EVENT_TYPE:
      return [{ kind: "person", userId }];
  }
}

function identifierStreams(identifierIds: string[]): IdentityStream[] {
  return [...new Set(identifierIds)].map((identifierId) => ({
    kind: "identifier" as const,
    identifierId,
  }));
}

/** Per-aggregate reducer for one identifier's head. Total and conservative: unclean facts are left
 * alone rather than thrown. See ADR-127 for visibility limits and partial replay.
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
    case IDENTIFIER_ATTACHED_EVENT_TYPE:
      return foldAttached({ identifierId, head, fact });
    case IDENTIFIER_VERIFIED_EVENT_TYPE:
      return foldVerified({ identifierId, head, fact });
    case IDENTIFIER_DEAD_ENDED_EVENT_TYPE:
      return foldDeadEnded({ identifierId, head, fact });
    case PRIMARY_CHANGED_EVENT_TYPE:
      return foldPrimaryChanged({ identifierId, head, fact });
    case IDENTIFIER_DETACHED_EVENT_TYPE:
      return foldDetached({ identifierId, head, fact });
    case USER_ERASED_EVENT_TYPE:
      return foldErased({ head });
    case LINK_PROPOSED_EVENT_TYPE:
    case LINK_CONFIRMED_EVENT_TYPE:
    case LINK_REJECTED_EVENT_TYPE:
      // A proposal and its decision change no head: a confirmation attaches
      // through the ordinary ceremony, which states its own fact.
      return head;
  }
}

/** The row this stream did not have — unless it already has one. */
function foldAttached({
  identifierId,
  head,
  fact,
}: {
  identifierId: string;
  head: IdentifierHead;
  fact: IdentityFactOf<typeof IDENTIFIER_ATTACHED_EVENT_TYPE>;
}): IdentifierHead {
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

/**
 * Idempotent by construction, because a redelivered verify is normal: the
 * verification time keeps its FIRST value, and a head already standing PRIMARY
 * does not fall back down a step to VERIFIED.
 */
function foldVerified({
  identifierId,
  head,
  fact,
}: {
  identifierId: string;
  head: IdentifierHead;
  fact: IdentityFactOf<typeof IDENTIFIER_VERIFIED_EVENT_TYPE>;
}): IdentifierHead {
  if (fact.data.identifierId !== identifierId || !head) return head;
  // A tombstone or dead end never resurrects; PRIMARY stays PRIMARY.
  if (head.state !== "ATTACHED" && head.state !== "VERIFIED") return head;
  return {
    ...head,
    state: head.state === "ATTACHED" ? "VERIFIED" : head.state,
    verifiedAtMs: head.verifiedAtMs ?? fact.occurredAt,
  };
}

/**
 * A dead end reports on a verification that never landed, so a head that has
 * since verified, taken PRIMARY or been detached has outrun the fact. Such a
 * fact is stale rather than wrong, which is why it is dropped and not refused.
 */
function foldDeadEnded({
  identifierId,
  head,
  fact,
}: {
  identifierId: string;
  head: IdentifierHead;
  fact: IdentityFactOf<typeof IDENTIFIER_DEAD_ENDED_EVENT_TYPE>;
}): IdentifierHead {
  if (fact.data.identifierId !== identifierId || !head) return head;
  if (head.state !== "ATTACHED") return head;
  return { ...head, state: "DEAD_END" };
}

/** Applies both halves of a promotion to this head: promotion if eligible, demotion to enforce the
 * per-stream invariant that only one identifier is PRIMARY.
 */
function foldPrimaryChanged({
  identifierId,
  head,
  fact,
}: {
  identifierId: string;
  head: IdentifierHead;
  fact: IdentityFactOf<typeof PRIMARY_CHANGED_EVENT_TYPE>;
}): IdentifierHead {
  if (!head) return head;
  if (fact.data.identifierId === identifierId) {
    if (head.state !== "VERIFIED" && head.state !== "PRIMARY") return head;
    return { ...head, state: "PRIMARY" };
  }
  if (head.state !== "PRIMARY") return head;
  return { ...head, state: "VERIFIED" };
}

/**
 * `detachedAtMs` records the first detach and is never re-dated, so a replay
 * that redelivers the fact cannot move a tombstone other reads already quote.
 */
function foldDetached({
  identifierId,
  head,
  fact,
}: {
  identifierId: string;
  head: IdentifierHead;
  fact: IdentityFactOf<typeof IDENTIFIER_DETACHED_EVENT_TYPE>;
}): IdentifierHead {
  if (fact.data.identifierId !== identifierId || !head) return head;
  if (head.state === "DETACHED") return head;
  return { ...head, state: "DETACHED", detachedAtMs: fact.occurredAt };
}

/**
 * Erasure wipes the value and the hash and keeps everything else: the row, the
 * domain (an org-level fact), the state and the dates.
 */
function foldErased({ head }: { head: IdentifierHead }): IdentifierHead {
  if (!head) return head;
  return { ...head, value: null, identifierHash: null };
}

/** Generates one fact per stream that must move to enforce exactly one PRIMARY. The sweep of all
 * demotions happens here because a per-identifier fold cannot see the whole person. See ADR-127.
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

/** Generates the erasure fact naming all identifiers the person holds. Because per-identifier folds
 * cannot enforce a sweep, this reads the whole person to find all identifiers to wipe.
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
