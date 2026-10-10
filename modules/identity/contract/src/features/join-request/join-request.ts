import { ledgerActorSchema } from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** Join-request vocabulary: states, events, and reducer for the request lifecycle. Isomorphic and
 * domain-only: requester address never appears, only domain and the admin/policy/invite decision.
 * See ADR-117 D12.
 */

export const JOIN_REQUEST_STATES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "WITHDRAWN",
] as const;
export const joinRequestStateSchema = z.enum(JOIN_REQUEST_STATES);
export type JoinRequestState = z.infer<typeof joinRequestStateSchema>;

/** Who ended a request: user (withdrawal), policy (auto-join), or invite (D11 crossing point). Each
 * resolver type preserves different evidence for audit.
 */
export const JOIN_RESOLVER_TYPES = ["user", "policy", "invite"] as const;
export const joinResolverTypeSchema = z.enum(JOIN_RESOLVER_TYPES);
export type JoinResolverType = z.infer<typeof joinResolverTypeSchema>;

/** The policy id domain auto-join resolves with. One value, so an audit page
 *  can say which policy admitted somebody rather than "a policy did". */
export const DOMAIN_AUTO_JOIN_POLICY_ID = "domain-auto" as const;

/** The policy id a single sign-on arrival's recorded admission resolves with. */
export const SSO_ARRIVAL_POLICY_ID = "sso-arrival" as const;

const joinResolverSchemaDefinition = z.object({
  type: joinResolverTypeSchema,
  /** The admin's user id, the policy id, or the invitation id. */
  id: z.string().min(1),
});
export interface JoinResolverSchema extends Named<typeof joinResolverSchemaDefinition> {}
export const joinResolverSchema: JoinResolverSchema = joinResolverSchemaDefinition;
export type JoinResolver = z.infer<typeof joinResolverSchema>;

/**
 * How the requester's domain was matched: an address they proved is theirs,
 * or a domain the connection they signed in through proved is its. The two
 * are different authorities and the audit page says which decided.
 */
export const JOIN_MATCH_KINDS = ["verified-identifier-domain", "sso-connection-domain"] as const;
export const joinMatchKindSchema = z.enum(JOIN_MATCH_KINDS);
export type JoinMatchKind = z.infer<typeof joinMatchKindSchema>;

/**
 * Where a request was made (ADR-171 v6): `cli` when `langwatch login`'s device
 * approval sent a new account to the welcome screen, `web` otherwise. A `cli`
 * request lands a Developer; the origin only lowers the seat. Absent = `web`.
 */
export const JOIN_REQUEST_ORIGINS = ["web", "cli"] as const;
export const joinRequestOriginSchema = z.enum(JOIN_REQUEST_ORIGINS);
export type JoinRequestOrigin = z.infer<typeof joinRequestOriginSchema>;
export const DEFAULT_JOIN_REQUEST_ORIGIN: JoinRequestOrigin = "web";

/** Why a pending request was withdrawn. */
export const JOIN_WITHDRAWAL_CAUSES = ["user", "invite-accepted"] as const;
export const joinWithdrawalCauseSchema = z.enum(JOIN_WITHDRAWAL_CAUSES);
export type JoinWithdrawalCause = z.infer<typeof joinWithdrawalCauseSchema>;

// ---- events --------------------------------------------------------------

export const JOIN_REQUESTED_EVENT_TYPE = "lw.identity.join_requested" as const;
export const JOIN_APPROVED_EVENT_TYPE = "lw.identity.join_approved" as const;
export const JOIN_REJECTED_EVENT_TYPE = "lw.identity.join_rejected" as const;
export const JOIN_EXPIRED_EVENT_TYPE = "lw.identity.join_expired" as const;
export const JOIN_WITHDRAWN_EVENT_TYPE = "lw.identity.join_withdrawn" as const;

export const JOIN_REQUEST_EVENT_TYPES = [
  JOIN_REQUESTED_EVENT_TYPE,
  JOIN_APPROVED_EVENT_TYPE,
  JOIN_REJECTED_EVENT_TYPE,
  JOIN_EXPIRED_EVENT_TYPE,
  JOIN_WITHDRAWN_EVENT_TYPE,
] as const;
export type JoinRequestEventType = (typeof JOIN_REQUEST_EVENT_TYPES)[number];

export const JOIN_REQUEST_EVENT_VERSION_LATEST = "2026-08-24" as const;

const joinRequestedPayloadSchemaDefinition = z.object({
  joinRequestId: z.string().min(1),
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  /** The normalized domain the match was made on. The address itself is
   *  never a fact here — the domain is the whole of what was matched. */
  domain: z.string().min(1),
  matchedVia: joinMatchKindSchema,
  /** When the request lapses if nobody answers. Carried on the fact rather
   *  than computed at fold time, so a redelivered event cannot drift the
   *  deadline the requester was actually promised. */
  expiresAtMs: z.number().int().nonnegative(),
  /** Automatic policy approvals suppress the waiting notice; every other
   *  request derives it from this event, so the handoff cannot be lost
   *  between the command and a service-side callback. */
  notifyAdmins: z.boolean().default(true),
  /** Where the request was made. Defaulted so a fact written before origins
   *  existed folds to the same row the column default gives a replay. */
  origin: joinRequestOriginSchema.default(DEFAULT_JOIN_REQUEST_ORIGIN),
  /** The connection a single sign-on arrival came in through. Defaulted so an
   *  older fact folds to the null the column holds for it. */
  connectionId: z.string().min(1).nullable().default(null),
  actor: ledgerActorSchema,
});
export interface JoinRequestedPayloadSchema extends Named<
  typeof joinRequestedPayloadSchemaDefinition
> {}
export const joinRequestedPayloadSchema: JoinRequestedPayloadSchema =
  joinRequestedPayloadSchemaDefinition;
export type JoinRequestedPayload = z.infer<typeof joinRequestedPayloadSchema>;

const joinApprovedPayloadSchemaDefinition = z.object({
  joinRequestId: z.string().min(1),
  resolvedBy: joinResolverSchema,
  actor: ledgerActorSchema,
});
export interface JoinApprovedPayloadSchema extends Named<
  typeof joinApprovedPayloadSchemaDefinition
> {}
export const joinApprovedPayloadSchema: JoinApprovedPayloadSchema =
  joinApprovedPayloadSchemaDefinition;
export type JoinApprovedPayload = z.infer<typeof joinApprovedPayloadSchema>;

/** No reason field, on purpose: rejection is silent-ish, and a reason is a
 *  thing an admin would then be asked to justify. */
const joinRejectedPayloadSchemaDefinition = z.object({
  joinRequestId: z.string().min(1),
  resolvedBy: joinResolverSchema,
  actor: ledgerActorSchema,
});
export interface JoinRejectedPayloadSchema extends Named<
  typeof joinRejectedPayloadSchemaDefinition
> {}
export const joinRejectedPayloadSchema: JoinRejectedPayloadSchema =
  joinRejectedPayloadSchemaDefinition;
export type JoinRejectedPayload = z.infer<typeof joinRejectedPayloadSchema>;

const joinExpiredPayloadSchemaDefinition = z.object({
  joinRequestId: z.string().min(1),
  actor: ledgerActorSchema,
});
export interface JoinExpiredPayloadSchema extends Named<
  typeof joinExpiredPayloadSchemaDefinition
> {}
export const joinExpiredPayloadSchema: JoinExpiredPayloadSchema =
  joinExpiredPayloadSchemaDefinition;
export type JoinExpiredPayload = z.infer<typeof joinExpiredPayloadSchema>;

const joinWithdrawnPayloadSchemaDefinition = z.object({
  joinRequestId: z.string().min(1),
  cause: joinWithdrawalCauseSchema,
  actor: ledgerActorSchema,
});
export interface JoinWithdrawnPayloadSchema extends Named<
  typeof joinWithdrawnPayloadSchemaDefinition
> {}
export const joinWithdrawnPayloadSchema: JoinWithdrawnPayloadSchema =
  joinWithdrawnPayloadSchemaDefinition;
export type JoinWithdrawnPayload = z.infer<typeof joinWithdrawnPayloadSchema>;

export type JoinRequestFactInput =
  | { type: typeof JOIN_REQUESTED_EVENT_TYPE; data: JoinRequestedPayload }
  | { type: typeof JOIN_APPROVED_EVENT_TYPE; data: JoinApprovedPayload }
  | { type: typeof JOIN_REJECTED_EVENT_TYPE; data: JoinRejectedPayload }
  | { type: typeof JOIN_EXPIRED_EVENT_TYPE; data: JoinExpiredPayload }
  | { type: typeof JOIN_WITHDRAWN_EVENT_TYPE; data: JoinWithdrawnPayload };

const joinRequestFactInputSchemaDefinition = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(JOIN_REQUESTED_EVENT_TYPE),
    data: joinRequestedPayloadSchema,
  }),
  z.object({
    type: z.literal(JOIN_APPROVED_EVENT_TYPE),
    data: joinApprovedPayloadSchema,
  }),
  z.object({
    type: z.literal(JOIN_REJECTED_EVENT_TYPE),
    data: joinRejectedPayloadSchema,
  }),
  z.object({
    type: z.literal(JOIN_EXPIRED_EVENT_TYPE),
    data: joinExpiredPayloadSchema,
  }),
  z.object({
    type: z.literal(JOIN_WITHDRAWN_EVENT_TYPE),
    data: joinWithdrawnPayloadSchema,
  }),
]);
export interface JoinRequestFactInputSchema extends Named<
  typeof joinRequestFactInputSchemaDefinition
> {}
export const joinRequestFactInputSchema: JoinRequestFactInputSchema =
  joinRequestFactInputSchemaDefinition;

/** A fact with its business time — what the reducer folds. */
export type JoinRequestFact = JoinRequestFactInput & { occurredAt: number };

// ---- folded state --------------------------------------------------------

/** One request as the projection knows it, and the state every guard is
 *  evaluated against. */
export interface JoinRequestAggregateState {
  joinRequestId: string;
  userId: string;
  organizationId: string;
  domain: string;
  state: JoinRequestState;
  matchedVia: JoinMatchKind;
  /** Where it was made; what the seat is decided from on approval. */
  origin: JoinRequestOrigin;
  createdAtMs: number;
  updatedAtMs: number;
  /** When PENDING lapses. Null once the request has an ending. */
  expiresAtMs: number | null;
  resolvedAtMs: number | null;
  resolvedByType: JoinResolverType | null;
  resolvedById: string | null;
  /** Why it was withdrawn, when it was. */
  withdrawalCause: JoinWithdrawalCause | null;
  /** The connection a single sign-on arrival came in through; null otherwise. */
  connectionId: string | null;
}

export function emptyJoinRequest({
  joinRequestId,
}: {
  joinRequestId: string;
}): JoinRequestAggregateState {
  return {
    joinRequestId,
    userId: "",
    organizationId: "",
    domain: "",
    state: "PENDING",
    matchedVia: "verified-identifier-domain",
    origin: DEFAULT_JOIN_REQUEST_ORIGIN,
    createdAtMs: 0,
    updatedAtMs: 0,
    expiresAtMs: null,
    resolvedAtMs: null,
    resolvedByType: null,
    resolvedById: null,
    withdrawalCause: null,
    connectionId: null,
  };
}

/** PENDING is the only state anything can be done from. */
export function isPendingJoinRequest(state: JoinRequestState): boolean {
  return state === "PENDING";
}

/**
 * The reducer. Pure and total: the same function runs in the framework's
 * fold, the replay proof, and a browser tab. Guards refuse a forbidden fact
 * before it exists, so this states transitions, never re-checks them.
 */
export function reduceJoinRequest({
  state,
  fact,
}: {
  state: JoinRequestAggregateState;
  fact: JoinRequestFact;
}): JoinRequestAggregateState {
  const touched = { ...state, updatedAtMs: fact.occurredAt };
  switch (fact.type) {
    case JOIN_REQUESTED_EVENT_TYPE:
      return {
        ...touched,
        joinRequestId: fact.data.joinRequestId,
        userId: fact.data.userId,
        organizationId: fact.data.organizationId,
        domain: fact.data.domain,
        matchedVia: fact.data.matchedVia,
        origin: fact.data.origin,
        connectionId: fact.data.connectionId,
        state: "PENDING",
        expiresAtMs: fact.data.expiresAtMs,
        createdAtMs: fact.occurredAt,
      };
    case JOIN_APPROVED_EVENT_TYPE:
      return {
        ...touched,
        state: "APPROVED",
        expiresAtMs: null,
        resolvedAtMs: fact.occurredAt,
        resolvedByType: fact.data.resolvedBy.type,
        resolvedById: fact.data.resolvedBy.id,
      };
    case JOIN_REJECTED_EVENT_TYPE:
      return {
        ...touched,
        state: "REJECTED",
        expiresAtMs: null,
        resolvedAtMs: fact.occurredAt,
        resolvedByType: fact.data.resolvedBy.type,
        resolvedById: fact.data.resolvedBy.id,
      };
    case JOIN_EXPIRED_EVENT_TYPE:
      return {
        ...touched,
        state: "EXPIRED",
        expiresAtMs: null,
        resolvedAtMs: fact.occurredAt,
      };
    case JOIN_WITHDRAWN_EVENT_TYPE:
      return {
        ...touched,
        state: "WITHDRAWN",
        expiresAtMs: null,
        resolvedAtMs: fact.occurredAt,
        withdrawalCause: fact.data.cause,
      };
  }
}
