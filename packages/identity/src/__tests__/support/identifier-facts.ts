import type { IdentifierFact, IdentityFact, IdentityHeads } from "../../facts";
import { emptyIdentityHeads } from "../../facts";
import {
  type IdentifierHead,
  identityStreamsFor,
  reduceIdentifier,
} from "../../identifier-aggregate";
import { reduceIdentity } from "../../reduce";

/**
 * The facts one person's identity streams are built from, and the two folds a
 * case compares. Shared by the four `identifier-aggregate` suites so they state
 * one history the same way.
 */

export const USER = "user_sam";
export const ACTOR = { type: "user" as const, id: USER };
export const T0 = 1_690_000_000_000;

type AttachedData = Extract<
  IdentityFact,
  { type: "lw.identity.identifier_attached" }
>["data"];

export function attached({
  identifierId,
  occurredAt = T0,
  ...overrides
}: { identifierId: string; occurredAt?: number } & Partial<
  Omit<AttachedData, "identifierId">
>): IdentityFact {
  return {
    type: "lw.identity.identifier_attached",
    occurredAt,
    data: {
      identifierId,
      userId: USER,
      accountId: null,
      provider: "email",
      providerId: null,
      issuer: null,
      providerAccountId: null,
      value: "sam@acme.com",
      identifierHash: "hmac:abc",
      domain: "acme.com",
      connectionId: null,
      state: "ATTACHED",
      actor: ACTOR,
      ...overrides,
    },
  };
}

export function verified({
  identifierId,
  occurredAt = T0 + 1,
}: {
  identifierId: string;
  occurredAt?: number;
}): IdentityFact {
  return {
    type: "lw.identity.identifier_verified",
    occurredAt,
    data: {
      identifierId,
      verificationId: null,
      method: "creation",
      actor: ACTOR,
    },
  };
}

export function primaryChanged({
  identifierId,
  previousIdentifierId = null,
  occurredAt = T0 + 2,
}: {
  identifierId: string;
  previousIdentifierId?: string | null;
  occurredAt?: number;
}): IdentityFact {
  return {
    type: "lw.identity.primary_changed",
    occurredAt,
    data: { identifierId, previousIdentifierId, actor: ACTOR },
  };
}

export function detached({
  identifierId,
  occurredAt = T0 + 3,
}: {
  identifierId: string;
  occurredAt?: number;
}): IdentityFact {
  return {
    type: "lw.identity.identifier_detached",
    occurredAt,
    data: { identifierId, actor: ACTOR },
  };
}

export function erased(erasedIdentifierIds: string[]): IdentityFact {
  return {
    type: "lw.identity.user_erased",
    occurredAt: T0 + 4,
    data: {
      userId: USER,
      erasedIdentifierIds,
      actor: { type: "system", id: "ops:erasure-request" },
    },
  };
}

export function proposed(): IdentityFact {
  return {
    type: "lw.identity.link_proposed",
    occurredAt: T0 + 5,
    data: {
      proposalId: "prop_1",
      userId: USER,
      connectionId: null,
      provider: "oidc",
      providerAccountId: "sub_1",
      value: "sam@acme.com",
      domain: "acme.com",
      reason: "ambiguous_candidates",
      actor: ACTOR,
    },
  };
}

export function deadEnded({
  identifierId,
  occurredAt = T0 + 6,
}: {
  identifierId: string;
  occurredAt?: number;
}): IdentityFact {
  return {
    type: "lw.identity.identifier_dead_ended",
    occurredAt,
    data: { identifierId, reason: "verification_failed", actor: ACTOR },
  };
}

/** The identifier streams one fact is routed to. */
export function identifierStreamIds(fact: IdentityFact): string[] {
  return identityStreamsFor({ fact, userId: USER })
    .filter((stream) => stream.kind === "identifier")
    .map((stream) => stream.identifierId);
}

/** The whole history of one stream, folded the way its own aggregate would. */
export function foldStream({
  identifierId,
  facts,
}: {
  identifierId: string;
  facts: IdentityFact[];
}): IdentifierHead {
  return facts
    .filter((fact) => identifierStreamIds(fact).includes(identifierId))
    .reduce<IdentifierHead>(
      (head, fact) => reduceIdentifier({ identifierId, head, fact }),
      null,
    );
}

/** One head, in whatever state a case needs it. */
export function headIn(state: IdentifierFact["state"]): IdentifierFact {
  const head = foldUser([attached({ identifierId: "idf_work" })]).identifiers
    .idf_work;
  if (!head) throw new Error("the fixture attach produced no head");
  return { ...head, state };
}

/** The same history, folded by the per-person reducer instead. */
export function foldUser(facts: IdentityFact[]): IdentityHeads {
  return facts.reduce(
    (heads, fact) => reduceIdentity({ heads, fact }),
    emptyIdentityHeads({ userId: USER }),
  );
}
