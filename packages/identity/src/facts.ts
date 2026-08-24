import { z } from "zod";
import {
  type IdentifierLifecycleState,
  type IdentifierProvider,
  identifierArrivalStateSchema,
  identifierProviderSchema,
  identityActorSchema,
  verificationMethodSchema,
} from "./vocabulary";

/**
 * The identity facts (ADR-101, D01): what an identity event SAYS, without
 * the event-sourcing envelope that carries it. The app's pipeline composes
 * each payload here with its framework `EventSchema` (id, aggregate, tenant,
 * cursor time); the reducer folds the payload plus `occurredAt` and nothing
 * else, which is what lets the same reducer run inside the framework and in
 * a browser tab.
 *
 * Payloads carry ids, enums, timestamps, email domains, HMAC hashes — and
 * the normalized email itself where the fact is about one (the payload
 * rule, ADR-101 §4). Secrets never appear in any fact: protocol values ride
 * only on commands and land through repositories as row-truth on `Account`.
 *
 * Erasure (R11) is the one sanctioned log mutation: it wipes `value` and
 * `identifierHash` out of the user's prior events, which is why both are
 * nullable here — a schema that required them would refuse the user's own
 * erased history on replay. `domain` is an org-level fact and survives.
 */

export const IDENTIFIER_ATTACHED_EVENT_TYPE =
  "lw.identity.identifier_attached" as const;
export const IDENTIFIER_VERIFIED_EVENT_TYPE =
  "lw.identity.identifier_verified" as const;
export const IDENTIFIER_DEAD_ENDED_EVENT_TYPE =
  "lw.identity.identifier_dead_ended" as const;
export const PRIMARY_CHANGED_EVENT_TYPE =
  "lw.identity.primary_changed" as const;
export const IDENTIFIER_DETACHED_EVENT_TYPE =
  "lw.identity.identifier_detached" as const;
export const USER_ERASED_EVENT_TYPE = "lw.identity.user_erased" as const;
export const LINK_PROPOSED_EVENT_TYPE = "lw.identity.link_proposed" as const;

export const IDENTITY_EVENT_TYPES = [
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  PRIMARY_CHANGED_EVENT_TYPE,
  IDENTIFIER_DETACHED_EVENT_TYPE,
  USER_ERASED_EVENT_TYPE,
  LINK_PROPOSED_EVENT_TYPE,
] as const;
export type IdentityEventType = (typeof IDENTITY_EVENT_TYPES)[number];

export const IDENTITY_EVENT_VERSION_LATEST = "2026-08-20" as const;

export const identifierAttachedPayloadSchema = z.object({
  /** Deterministic (identity-server's `deriveIdentifierId`) — backfill and
   *  live emission of the same fact converge on the same projection row. */
  identifierId: z.string().min(1),
  userId: z.string().min(1),
  /** The better-auth protocol row this identifier mirrors, when one
   *  exists (an email alias attached for routing has none). */
  accountId: z.string().min(1).nullable(),
  provider: identifierProviderSchema,
  /** The provider's own subject for this user - `sub` for OIDC, the
   *  mailbox for `email`. It is what an IdP callback arrives holding, so
   *  the projection has to carry it to answer "who is this?" without the
   *  legacy Account row (ADR-116). Part of the identifier's derived id
   *  since D01, but only stated on the fact from ADR-116 on. */
  providerAccountId: z.string().nullable(),
  /** Normalized identifier value (the email for `email` and OAuth
   *  providers, the provider subject otherwise). Wiped by erasure. */
  value: z.string().nullable(),
  /** HMAC-SHA256(userHashKey, normalized value); unlinkable noise once
   *  erasure shreds the key. Null when the user's hash key was not yet
   *  minted. Wiped by erasure. */
  identifierHash: z.string().nullable(),
  /** Org-level fact; survives erasure. */
  domain: z.string().nullable(),
  /** FK-shaped → sso_connections from D04 on. */
  connectionId: z.string().nullable(),
  state: identifierArrivalStateSchema,
  actor: identityActorSchema,
});

export const identifierVerifiedPayloadSchema = z.object({
  identifierId: z.string().min(1),
  /** The consumed Verification record — the ceremony's proof trail
   *  (magic-link only; OAuth/SAML ceremonies verify by arriving). */
  verificationId: z.string().min(1).nullable(),
  method: verificationMethodSchema,
  actor: identityActorSchema,
});

export const identifierDeadEndedPayloadSchema = z.object({
  identifierId: z.string().min(1),
  reason: z.enum(["verification_failed", "uniqueness_race_lost"]),
  actor: identityActorSchema,
});

export const primaryChangedPayloadSchema = z.object({
  /** The identifier taking PRIMARY. */
  identifierId: z.string().min(1),
  /** The identifier it demotes back to VERIFIED; null on first primary. */
  previousIdentifierId: z.string().min(1).nullable(),
  actor: identityActorSchema,
});

export const identifierDetachedPayloadSchema = z.object({
  identifierId: z.string().min(1),
  actor: identityActorSchema,
});

export const userErasedPayloadSchema = z.object({
  userId: z.string().min(1),
  erasedIdentifierIds: z.array(z.string().min(1)),
  actor: identityActorSchema,
});

/**
 * Why a callback's link was not made automatically (ADR-117 §3). Each value is
 * a refusal a human has to resolve, and the org-admin surface renders it.
 */
export const linkProposalReasonSchema = z.enum([
  /** The matched row holds the address with no verification evidence at all —
   *  the "unverified orphan cannot be hijacked" invariant, kept. */
  "unverified_orphan",
  /** More than one user holds the asserted address. */
  "ambiguous_candidates",
  /** The matched user holds identifiers on domains the organization cannot
   *  vouch for, so the connection may not claim the whole row. */
  "unvouched_identifiers",
]);
export type LinkProposalReason = z.infer<typeof linkProposalReasonSchema>;

/**
 * A callback matched somebody, but not unambiguously enough to link without a
 * human (ADR-117 §3). Stated as a fact rather than a row so the proposal has
 * the same history, the same erasure and the same replay as every other thing
 * we know about an identity — and so the refusal an operator is asked about
 * later is evidenced rather than reconstructed.
 */
export const linkProposedPayloadSchema = z.object({
  proposalId: z.string().min(1),
  /** The user the callback would have been linked to. */
  userId: z.string().min(1),
  /** The connection whose callback proposed it; null until D04 gives the
   *  legacy env provider a connection of its own. */
  connectionId: z.string().nullable(),
  provider: identifierProviderSchema,
  /** The IdP's own subject — an opaque identifier, never a secret. */
  providerAccountId: z.string().min(1),
  /** Normalized asserted value; wiped by erasure, like every other value. */
  value: z.string().nullable(),
  /** Org-level fact; survives erasure. */
  domain: z.string().nullable(),
  reason: linkProposalReasonSchema,
  actor: identityActorSchema,
});

/**
 * A fact as a command decides it: the type and the payload. The framework
 * envelope (aggregate, tenant, ids, idempotency key) and `occurredAt` are
 * stamped by whoever appends — the app's pipeline envelope — from the
 * command that produced it.
 */
export const identityFactInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(IDENTIFIER_ATTACHED_EVENT_TYPE),
    data: identifierAttachedPayloadSchema,
  }),
  z.object({
    type: z.literal(IDENTIFIER_VERIFIED_EVENT_TYPE),
    data: identifierVerifiedPayloadSchema,
  }),
  z.object({
    type: z.literal(IDENTIFIER_DEAD_ENDED_EVENT_TYPE),
    data: identifierDeadEndedPayloadSchema,
  }),
  z.object({
    type: z.literal(PRIMARY_CHANGED_EVENT_TYPE),
    data: primaryChangedPayloadSchema,
  }),
  z.object({
    type: z.literal(IDENTIFIER_DETACHED_EVENT_TYPE),
    data: identifierDetachedPayloadSchema,
  }),
  z.object({
    type: z.literal(USER_ERASED_EVENT_TYPE),
    data: userErasedPayloadSchema,
  }),
  z.object({
    type: z.literal(LINK_PROPOSED_EVENT_TYPE),
    data: linkProposedPayloadSchema,
  }),
]);
export type IdentityFactInput = z.infer<typeof identityFactInputSchema>;

/** A fact with its business time — what the reducer folds. Every framework
 *  identity event is structurally one of these. */
export type IdentityFact = IdentityFactInput & { occurredAt: number };

export type IdentityFactOf<T extends IdentityEventType> = Extract<
  IdentityFact,
  { type: T }
>;

/** One identifier as the projection knows it — one row of `Identifier`. */
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
  /** The provider's own subject (ADR-116) - the IdP callback's lookup key. */
  providerAccountId: string | null;
  connectionId: string | null;
  state: IdentifierLifecycleState;
  verifiedAtMs: number | null;
  attachedAtMs: number;
  detachedAtMs: number | null;
}

/** A user's identifier heads: the reducer's state, the projection's rows. */
export interface IdentityHeads {
  userId: string;
  identifiers: Record<string, IdentifierFact>;
}

export function emptyIdentityHeads({
  userId,
}: {
  userId: string;
}): IdentityHeads {
  return { userId, identifiers: {} };
}

// ---- commands ------------------------------------------------------------

/**
 * Command inputs (ADR-101, D01). Every command carries a caller-minted
 * `commandId`: the caller mints it once, retries reuse it, and each emitted
 * fact's idempotency key is `<commandId>:<index>` — a retried command dedupes
 * at the event store while a legitimately repeated action never can. The
 * backfill derives its commandIds deterministically from source rows
 * (`backfill:<accountId>`); ceremony paths mint a random KSUID.
 *
 * PII rides here transiently — commands are dispatched and processed, never
 * durably stored — and the RAW identifier value rides only on the command:
 * the guard normalizes it, and only the normalized form ever reaches a fact.
 */

export const ATTACH_IDENTIFIER_COMMAND_TYPE =
  "lw.identity.attach_identifier" as const;
export const VERIFY_IDENTIFIER_COMMAND_TYPE =
  "lw.identity.verify_identifier" as const;
export const MARK_PRIMARY_COMMAND_TYPE = "lw.identity.mark_primary" as const;
export const DETACH_IDENTIFIER_COMMAND_TYPE =
  "lw.identity.detach_identifier" as const;
export const ERASE_USER_COMMAND_TYPE = "lw.identity.erase_user" as const;
export const PROPOSE_LINK_COMMAND_TYPE = "lw.identity.propose_link" as const;

export const IDENTITY_COMMAND_TYPES = [
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  VERIFY_IDENTIFIER_COMMAND_TYPE,
  MARK_PRIMARY_COMMAND_TYPE,
  DETACH_IDENTIFIER_COMMAND_TYPE,
  ERASE_USER_COMMAND_TYPE,
  PROPOSE_LINK_COMMAND_TYPE,
] as const;
export type IdentityCommandType = (typeof IDENTITY_COMMAND_TYPES)[number];

const commandIdentitySchema = z.object({
  /** The user IS the tenant of their own identity history (ADR-029 §4);
   *  the framework builds the command envelope's tenantId from this field. */
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  commandId: z.string().min(1),
});

/**
 * Every identity command carries the identity block AND the invariant that
 * makes it one history per user: `tenantId === userId`. The emitted fact
 * takes its `tenantId` from the command envelope and its `aggregateId` from
 * `userId` — a caller wiring them differently would persist the event under
 * one tenant's stream and fold it into another user's projection, which
 * nothing downstream can detect. Refused at the wire boundary instead.
 *
 * Exported because `mfa.ts` is the same shape of aggregate — one history per
 * person, the person as the tenant — and the invariant has to hold there for
 * the same reason. Two copies of a refinement is two ways for it to drift.
 */
export function userTenantedCommandSchema<Shape extends z.ZodRawShape>(
  shape: Shape,
) {
  return commandIdentitySchema
    .extend(shape)
    .refine((data) => data.tenantId === data.userId, {
      message: "tenantId must equal userId: one identity history per user",
      path: ["tenantId"],
    });
}

export const attachIdentifierCommandDataSchema = userTenantedCommandSchema({
  /** The better-auth protocol row, when one exists. */
  accountId: z.string().min(1).nullable(),
  provider: identifierProviderSchema,
  /** The provider's own account id (OAuth `providerAccountId`) — part of
   *  the identifier's deterministic identity when present, and from
   *  ADR-116 stated on the fact so the projection can answer an IdP
   *  callback without the legacy Account row. */
  providerAccountId: z.string().min(1).nullable(),
  /** RAW value as the ceremony delivered it — normalized by the guard,
   *  never stored in a fact un-normalized. */
  value: z.string().min(1),
  /** Business time of the fact; a backfilled identifier carries the legacy
   *  row's createdAt. Becomes the fact's `occurredAt` and the timestamp
   *  bits of the deterministic identifier id. */
  occurredAtMs: z.number().int().nonnegative(),
  ceremony: z.object({
    flow: z.string().min(1),
    requestId: z.string().min(1).optional(),
  }),
  actor: identityActorSchema,
});
export type AttachIdentifierCommandData = z.infer<
  typeof attachIdentifierCommandDataSchema
>;

export const verifyIdentifierCommandDataSchema = userTenantedCommandSchema({
  identifierId: z.string().min(1),
  /** The consumed Verification record (magic-link ceremonies). */
  verificationId: z.string().min(1).nullable(),
  method: verificationMethodSchema,
  occurredAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
});
export type VerifyIdentifierCommandData = z.infer<
  typeof verifyIdentifierCommandDataSchema
>;

export const markPrimaryCommandDataSchema = userTenantedCommandSchema({
  identifierId: z.string().min(1),
  occurredAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
});
export type MarkPrimaryCommandData = z.infer<
  typeof markPrimaryCommandDataSchema
>;

export const detachIdentifierCommandDataSchema = userTenantedCommandSchema({
  identifierId: z.string().min(1),
  occurredAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
});
export type DetachIdentifierCommandData = z.infer<
  typeof detachIdentifierCommandDataSchema
>;

export const eraseUserCommandDataSchema = userTenantedCommandSchema({
  occurredAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
});
export type EraseUserCommandData = z.infer<typeof eraseUserCommandDataSchema>;

export const proposeLinkCommandDataSchema = userTenantedCommandSchema({
  proposalId: z.string().min(1),
  connectionId: z.string().min(1).nullable(),
  provider: identifierProviderSchema,
  providerAccountId: z.string().min(1),
  /** RAW value as the callback asserted it — normalized by the guard. */
  value: z.string().min(1),
  reason: linkProposalReasonSchema,
  occurredAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
});
export type ProposeLinkCommandData = z.infer<
  typeof proposeLinkCommandDataSchema
>;

/** One identity command, typed on its verb — what the ledger stages. */
export type IdentityCommand =
  | { type: typeof ATTACH_IDENTIFIER_COMMAND_TYPE; data: AttachIdentifierCommandData }
  | { type: typeof VERIFY_IDENTIFIER_COMMAND_TYPE; data: VerifyIdentifierCommandData }
  | { type: typeof MARK_PRIMARY_COMMAND_TYPE; data: MarkPrimaryCommandData }
  | { type: typeof DETACH_IDENTIFIER_COMMAND_TYPE; data: DetachIdentifierCommandData }
  | { type: typeof ERASE_USER_COMMAND_TYPE; data: EraseUserCommandData }
  | { type: typeof PROPOSE_LINK_COMMAND_TYPE; data: ProposeLinkCommandData };
