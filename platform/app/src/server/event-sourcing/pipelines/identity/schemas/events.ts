import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IDENTIFIER_DETACHED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
  PRIMARY_CHANGED_EVENT_TYPE,
  USER_ERASED_EVENT_TYPE,
} from "./constants";

/**
 * The identity pipeline's wire schemas (ADR-101, D01). Payloads carry ids,
 * enums, timestamps, email domains, HMAC hashes — and the normalized email
 * itself where the fact is about one (the payload rule, ADR-101 §4). Secrets
 * never appear in any event: protocol values ride only on commands and land
 * through repositories as row-truth on `Account`.
 *
 * Erasure (R11) is the one sanctioned log mutation: it wipes `email` and
 * `identifierHash` out of the user's prior events, which is why both are
 * nullable here — a schema that required them would refuse the user's own
 * erased history on replay. `domain` is an org-level fact and survives.
 *
 * Time lives on the event envelope: `occurredAt` is business time (a
 * backfilled identifier carries the legacy row's `createdAt`), `createdAt`
 * is ledger-accepted time.
 */

export const identityActorSchema = z.object({
  type: z.enum(["user", "system"]),
  id: z.string().nullable(),
});

/** The widened provider vocabulary (D01). `auth0-legacy` / `okta-legacy`
 *  exist for D09's per-customer migrations — nothing emits them yet. */
export const identifierProviderSchema = z.enum([
  "credential",
  "email",
  "passkey",
  "google",
  "github",
  "gitlab",
  "azure-ad",
  "oidc",
  "saml",
  "auth0-legacy",
  "okta-legacy",
]);
export type IdentifierProvider = z.infer<typeof identifierProviderSchema>;

/**
 * An identifier arrives ATTACHED or VERIFIED, never further along:
 * OAuth/SSO ceremonies and account-control providers (credential, passkey)
 * arrive VERIFIED (R8 — the ceremony itself is the proof), `email` arrives
 * ATTACHED and verifies via the magic-link ceremony. PRIMARY, DEAD_END and
 * DETACHED are transitions, not arrivals — each has its own event.
 */
export const identifierArrivalStateSchema = z.enum(["ATTACHED", "VERIFIED"]);

export const verificationMethodSchema = z.enum([
  "magic-link",
  "oauth",
  "saml",
  "creation",
]);
export type VerificationMethod = z.infer<typeof verificationMethodSchema>;

export const identifierAttachedEventSchema = EventSchema.extend({
  type: z.literal(IDENTIFIER_ATTACHED_EVENT_TYPE),
  data: z.object({
    /** Deterministic (see `identifierIdentity.ts`) — backfill and live
     *  emission of the same fact converge on the same projection row. */
    identifierId: z.string().min(1),
    userId: z.string().min(1),
    /** The better-auth protocol row this identifier mirrors, when one
     *  exists (an email alias attached for routing has none). */
    accountId: z.string().min(1).nullable(),
    provider: identifierProviderSchema,
    /** Normalized value; the fact where the fact is about an email.
     *  Wiped by erasure. */
    email: z.string().nullable(),
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
  }),
});
export type IdentifierAttachedEvent = z.infer<
  typeof identifierAttachedEventSchema
>;

export const identifierVerifiedEventSchema = EventSchema.extend({
  type: z.literal(IDENTIFIER_VERIFIED_EVENT_TYPE),
  data: z.object({
    identifierId: z.string().min(1),
    /** The consumed Verification record — the ceremony's proof trail
     *  (magic-link only; OAuth/SAML ceremonies verify by arriving). */
    verificationId: z.string().min(1).nullable(),
    method: verificationMethodSchema,
    actor: identityActorSchema,
  }),
});
export type IdentifierVerifiedEvent = z.infer<
  typeof identifierVerifiedEventSchema
>;

export const identifierDeadEndedEventSchema = EventSchema.extend({
  type: z.literal(IDENTIFIER_DEAD_ENDED_EVENT_TYPE),
  data: z.object({
    identifierId: z.string().min(1),
    reason: z.enum(["verification_failed", "uniqueness_race_lost"]),
    actor: identityActorSchema,
  }),
});
export type IdentifierDeadEndedEvent = z.infer<
  typeof identifierDeadEndedEventSchema
>;

export const primaryChangedEventSchema = EventSchema.extend({
  type: z.literal(PRIMARY_CHANGED_EVENT_TYPE),
  data: z.object({
    /** The identifier taking PRIMARY. */
    identifierId: z.string().min(1),
    /** The identifier it demotes back to VERIFIED; null on first primary. */
    previousIdentifierId: z.string().min(1).nullable(),
    actor: identityActorSchema,
  }),
});
export type PrimaryChangedEvent = z.infer<typeof primaryChangedEventSchema>;

export const identifierDetachedEventSchema = EventSchema.extend({
  type: z.literal(IDENTIFIER_DETACHED_EVENT_TYPE),
  data: z.object({
    identifierId: z.string().min(1),
    actor: identityActorSchema,
  }),
});
export type IdentifierDetachedEvent = z.infer<
  typeof identifierDetachedEventSchema
>;

export const userErasedEventSchema = EventSchema.extend({
  type: z.literal(USER_ERASED_EVENT_TYPE),
  data: z.object({
    userId: z.string().min(1),
    erasedIdentifierIds: z.array(z.string().min(1)),
    actor: identityActorSchema,
  }),
});
export type UserErasedEvent = z.infer<typeof userErasedEventSchema>;

export const identityEventSchema = z.discriminatedUnion("type", [
  identifierAttachedEventSchema,
  identifierVerifiedEventSchema,
  identifierDeadEndedEventSchema,
  primaryChangedEventSchema,
  identifierDetachedEventSchema,
  userErasedEventSchema,
]);
export type IdentityEvent = z.infer<typeof identityEventSchema>;
