import { z } from "zod";
import type { RoutableConnection } from "./signin-routing";
import { identityActorSchema } from "./vocabulary";

/**
 * The SSO connection vocabulary (ADR-117 §5, D04): what a connection is, the
 * lifecycle it moves through, what each of its events SAYS, and the pure
 * reducer that folds them into one connection's state.
 *
 * Isomorphic like the rest of this package — no Prisma, no env, no framework,
 * no clock. The guards that decide whether a command may state a fact are
 * `@langwatch/identity-server`; the envelope that carries a fact into the
 * event log is the app's pipeline.
 *
 * The payload rule is ADR-101 §4's, unchanged: ids, domains, enums, hashes.
 * An IdP client secret never appears in a fact — the projection holds a
 * `secretRef` and the events carry the reference. The DNS ceremony carries
 * the verification token's HASH; the token itself is shown to the operator
 * once and never recorded.
 */

/**
 * The protocol a connection speaks. The aggregate is deliberately
 * protocol-agnostic: `idpMetadata` carries either shape, and which engine
 * actually terminates SAML is ADR-117 §5's named debt, due at D05's
 * onboarding. Nothing here needs that answer.
 */
export const SSO_CONNECTION_TYPES = ["oidc", "saml"] as const;
export const ssoConnectionTypeSchema = z.enum(SSO_CONNECTION_TYPES);
export type SsoConnectionType = z.infer<typeof ssoConnectionTypeSchema>;

/**
 * The lifecycle (ADR-117 §5):
 *
 *   DRAFT → CLAIMED → APPROVED → VERIFICATION_PENDING → VERIFIED → ACTIVE
 *             │  └→ REJECTED (re-claimable)              ACTIVE ⇄ SUSPENDED
 *             └→ DISCARDED           ACTIVE|SUSPENDED → TEARDOWN_PENDING
 *                                              └→ TORN_DOWN (grace elapsed)
 *
 * REJECTED is not terminal: the note is recorded and the domain may be
 * claimed again, which is what makes an ops mistake recoverable without a
 * second connection. DISCARDED and TORN_DOWN are.
 */
export const SSO_CONNECTION_STATES = [
  "DRAFT",
  "CLAIMED",
  "APPROVED",
  "REJECTED",
  "DISCARDED",
  "VERIFICATION_PENDING",
  "VERIFIED",
  "ACTIVE",
  "SUSPENDED",
  "TEARDOWN_PENDING",
  "TORN_DOWN",
] as const;
export const ssoConnectionStateSchema = z.enum(SSO_CONNECTION_STATES);
export type SsoConnectionLifecycleState = z.infer<
  typeof ssoConnectionStateSchema
>;

/**
 * How a domain claim is proved. Self-hosted installations that cannot
 * publish a TXT record prove ownership with their license token instead.
 *
 * `https-file` is the published-proof ceremony's second channel: the same
 * minted token, served by the domain at the well-known path instead of
 * published as a TXT record, for the customer whose DNS is a ticket away
 * but whose web server is not. It is a METHOD a verified fact can carry and
 * not a ceremony of its own — the ceremony is minted once as `dns-txt` and
 * either channel satisfies it (see `SSO_PUBLISHED_PROOF_CHANNELS`).
 *
 * `operator-attested` is the D05 amendment: a LangWatch operator states out
 * of band that the domain is that organization's, which replaces the PROOF
 * and never the approval. It publishes nothing, so it carries no token and
 * is not a two-step ceremony — which is why it is absent from
 * `SSO_VERIFICATION_CEREMONY_METHODS` below and has a verb of its own.
 *
 * `legacy-configuration` is not a ceremony and cannot be requested: it is
 * what the grandfather migration states for a domain that was already
 * serving production sign-ins through `Organization.ssoDomain` before
 * connections existed. The proof is that history, and re-running a DNS
 * ceremony against a domain the platform has been routing for years would
 * be theater. The ceremony commands accept only the methods in
 * `SSO_VERIFICATION_CEREMONY_METHODS`.
 */
export const SSO_VERIFICATION_METHODS = [
  "dns-txt",
  "https-file",
  "license-token",
  "operator-attested",
  "legacy-configuration",
] as const;
export const ssoVerificationMethodSchema = z.enum(SSO_VERIFICATION_METHODS);
export type SsoVerificationMethod = z.infer<typeof ssoVerificationMethodSchema>;

/**
 * What happens to somebody who signs in through this connection and is not a
 * member yet (ADR-117 §3).
 *
 * THREE ANSWERS AND NO FOURTH:
 *
 *   admit   — they join. Bounded, and not by this setting: routing only ever
 *             sends an address to a connection whose domain that connection
 *             PROVED, so "anybody who reaches this" already means "anybody on
 *             a domain you proved and configured a provider for".
 *   request — they exist, and they wait. An administrator answers, the same
 *             way they answer any other request to join (D12).
 *   refuse  — the sign-in is turned away. The connection carries the people
 *             already here and nobody else.
 *
 * IT IS ASKED, NEVER ASSUMED. Registering a connection is a strong statement
 * of intent and it is still not this one: an organization that federates
 * sign-in has not thereby said that everybody their provider knows about
 * belongs here. So registration states an answer and the setup journey asks
 * for a better one before the connection may go live.
 *
 * `refuse` is what registration states, because it is the only answer that
 * cannot surprise anybody: a connection nobody has decided about admits
 * nobody new. The screen that asks recommends `admit`, which is the answer
 * most organizations want — but the recommendation is a person's to take.
 *
 * THERE IS ONE FIELD. This was two for a while — a boolean `allowsJit` and
 * this policy, kept in step by hand — and the two disagreed: the fold wrote
 * `allowsJit: policy === "admit"`, so an organization that chose "they ask,
 * you approve" got a connection that routed sign-ins and then provisioned
 * nothing. No account, no request, and nobody to approve. One field cannot
 * disagree with itself.
 */
export const SSO_ARRIVAL_POLICIES = ["admit", "request", "refuse"] as const;
export const ssoArrivalPolicySchema = z.enum(SSO_ARRIVAL_POLICIES);
export type SsoArrivalPolicy = z.infer<typeof ssoArrivalPolicySchema>;

/** What a connection admits before anybody has chosen. */
export const DEFAULT_SSO_ARRIVAL_POLICY: SsoArrivalPolicy = "refuse";

export const SSO_VERIFICATION_CEREMONY_METHODS = [
  "dns-txt",
  "license-token",
] as const;
export const ssoVerificationCeremonyMethodSchema = z.enum(
  SSO_VERIFICATION_CEREMONY_METHODS,
);
export type SsoVerificationCeremonyMethod = z.infer<
  typeof ssoVerificationCeremonyMethodSchema
>;

/**
 * The two channels one published-proof ceremony can be satisfied through.
 *
 * A ceremony on the published-proof tier mints ONE token and is recorded as
 * `dns-txt` — that is still the ceremony's name — but the customer may hand
 * the token back either way: as a TXT record on the domain, or as a file the
 * domain serves at the well-known path. Both demonstrate the same thing,
 * control of the domain, so both are decided by the same pending ceremony
 * and the same hash. Which channel actually proved it is what the verified
 * fact's `method` records, so the re-proof sweep re-reads the evidence where
 * it actually lives.
 */
const SSO_PUBLISHED_PROOF_CHANNELS = ["dns-txt", "https-file"] as const;
export const ssoPublishedProofChannelSchema = z.enum(
  SSO_PUBLISHED_PROOF_CHANNELS,
);
export type SsoPublishedProofChannel = z.infer<
  typeof ssoPublishedProofChannelSchema
>;

/**
 * Who authorized a domain claim. The trust decision behind a domain has
 * three possible sources, and a connection's history has to say which one it
 * was:
 *
 * - `platform-operator` — a LangWatch operator decided it, which is tier 1
 *   and the dispute queue. Still the abuse boundary for the one question a
 *   record cannot answer: two organizations claiming the same domain.
 * - `license` — a self-hosted installation's enterprise licence decided it
 *   (D05 tier 2). There is nobody to reach on such an installation, so the
 *   licence IS the authorization; it can never authorize a hosted
 *   organization's claim, because a hosted deployment holds no instance
 *   licence to speak with.
 * - `dns-proof` — a record published on the domain decided it. The strongest
 *   evidence anybody can hand us, and the one an operator re-reading it
 *   could only agree with, so it authorizes the claim directly. It is never
 *   a value a caller may assert: the guard states it itself, in the same
 *   commit as the proof it rests on, and refuses it anywhere else.
 *
 * Recorded on the approval fact rather than inferred from the deployment,
 * because a deployment changes and a fact does not: a dispute about a domain
 * is answered from the history alone.
 */
export const SSO_DOMAIN_CLAIM_AUTHORITIES = [
  "platform-operator",
  "license",
  "dns-proof",
] as const;
export const ssoDomainClaimAuthoritySchema = z.enum(
  SSO_DOMAIN_CLAIM_AUTHORITIES,
);
export type SsoDomainClaimAuthority = z.infer<
  typeof ssoDomainClaimAuthoritySchema
>;

/**
 * Whether the evidence behind a proved domain is still there.
 *
 * A published record is only evidence while it is published, and until
 * re-verification existed a domain proved once was proved forever — a
 * customer who deleted the record in a spring clean, or lost the domain
 * entirely, kept vouching for whoever asked. These three states are the
 * answer, and they are deliberately about the EVIDENCE rather than about the
 * connection: none of them moves the lifecycle, suspends anything, or stops
 * a single person who already works there from signing in.
 *
 * - `VERIFIED` — the record is where it should be, or has not been
 *   contradicted. The only state that vouches for somebody NEW.
 * - `WAVERING` — a check found the name resolving with no matching record on
 *   it. Nothing changes about who may do what; the organization's
 *   administrators are told, and a clock starts.
 * - `LAPSED` — the record stayed missing through the whole grace window. The
 *   domain stops vouching for new people: no provisioning on first sign-in,
 *   no joining by domain. Everyone already here is untouched, and publishing
 *   the record again returns it to `VERIFIED` with nothing to redo.
 *
 * What can never move a domain along this path is a lookup that FAILED. A
 * resolver that timed out has said nothing about the customer's DNS, so it
 * starts no clock and advances none — see `SSO_DNS_REPROOF_GRACE_MS`.
 */
export const SSO_DOMAIN_PROOF_STATES = [
  "VERIFIED",
  "WAVERING",
  "LAPSED",
] as const;
export const ssoDomainProofStateSchema = z.enum(SSO_DOMAIN_PROOF_STATES);
export type SsoDomainProofState = z.infer<typeof ssoDomainProofStateSchema>;

/** Where a domain claim stands. `WAITING` is the only state the tier-3 queue
 *  lists, and `REJECTED` is not terminal — the domain may be claimed again. */
export const SSO_DOMAIN_CLAIM_STATES = [
  "WAITING",
  "APPROVED",
  "REJECTED",
] as const;
export const ssoDomainClaimStateSchema = z.enum(SSO_DOMAIN_CLAIM_STATES);
export type SsoDomainClaimState = z.infer<typeof ssoDomainClaimStateSchema>;

/**
 * Where a connection came from. `legacy-grandfathered` is stamped on every
 * event the grandfather migration emits, so an operator reading a
 * connection's history can always tell which ones a human configured and
 * which the migration inferred from two string columns.
 */
export const SSO_CONNECTION_SOURCES = [
  "self-serve",
  "legacy-grandfathered",
] as const;
export const ssoConnectionSourceSchema = z.enum(SSO_CONNECTION_SOURCES);
export type SsoConnectionSource = z.infer<typeof ssoConnectionSourceSchema>;

/**
 * The IdP's dialing information as a FACT carries it: endpoints and
 * REFERENCES. `clientIdRef` and `secretRef` name credential records; the
 * values live wherever credentials live and never in the log.
 */
export const ssoIdpMetadataSchema = z.object({
  issuer: z.string().min(1).nullable(),
  /** The provider id the sign-in surface dials (`okta`, `auth0`, …). */
  providerId: z.string().min(1),
  clientIdRef: z.string().min(1).nullable(),
  secretRef: z.string().min(1).nullable(),
  certRefs: z.array(z.string().min(1)),
});
export type SsoIdpMetadata = z.infer<typeof ssoIdpMetadataSchema>;

// ---- events --------------------------------------------------------------

export const CONNECTION_REGISTERED_EVENT_TYPE =
  "lw.identity.connection_registered" as const;
export const DOMAIN_CLAIMED_EVENT_TYPE = "lw.identity.domain_claimed" as const;
export const DOMAIN_CLAIM_APPROVED_EVENT_TYPE =
  "lw.identity.domain_claim_approved" as const;
export const DOMAIN_CLAIM_REJECTED_EVENT_TYPE =
  "lw.identity.domain_claim_rejected" as const;
export const CONNECTION_DISCARDED_EVENT_TYPE =
  "lw.identity.connection_discarded" as const;
export const VERIFICATION_REQUESTED_EVENT_TYPE =
  "lw.identity.verification_requested" as const;
export const DOMAIN_ATTESTED_EVENT_TYPE =
  "lw.identity.domain_attested" as const;
export const DOMAIN_WITHDRAWN_EVENT_TYPE =
  "lw.identity.domain_withdrawn" as const;
export const DOMAIN_VERIFIED_EVENT_TYPE =
  "lw.identity.domain_verified" as const;
export const DOMAIN_PROOF_WAVERED_EVENT_TYPE =
  "lw.identity.domain_proof_wavered" as const;
export const DOMAIN_PROOF_LAPSED_EVENT_TYPE =
  "lw.identity.domain_proof_lapsed" as const;
export const DOMAIN_PROOF_RECOVERED_EVENT_TYPE =
  "lw.identity.domain_proof_recovered" as const;
export const CONNECTION_ACTIVATED_EVENT_TYPE =
  "lw.identity.connection_activated" as const;
export const CONNECTION_SUSPENDED_EVENT_TYPE =
  "lw.identity.connection_suspended" as const;
export const CONNECTION_RESUMED_EVENT_TYPE =
  "lw.identity.connection_resumed" as const;
export const TEARDOWN_REQUESTED_EVENT_TYPE =
  "lw.identity.teardown_requested" as const;
export const CONNECTION_TORN_DOWN_EVENT_TYPE =
  "lw.identity.connection_torn_down" as const;
/** Who this connection admits, changed after registration stated it. */
export const CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE =
  "lw.identity.connection_arrival_policy_set" as const;

export const SSO_CONNECTION_EVENT_TYPES = [
  CONNECTION_REGISTERED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
  CONNECTION_DISCARDED_EVENT_TYPE,
  VERIFICATION_REQUESTED_EVENT_TYPE,
  DOMAIN_ATTESTED_EVENT_TYPE,
  DOMAIN_WITHDRAWN_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  DOMAIN_PROOF_WAVERED_EVENT_TYPE,
  DOMAIN_PROOF_LAPSED_EVENT_TYPE,
  DOMAIN_PROOF_RECOVERED_EVENT_TYPE,
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_SUSPENDED_EVENT_TYPE,
  CONNECTION_RESUMED_EVENT_TYPE,
  TEARDOWN_REQUESTED_EVENT_TYPE,
  CONNECTION_TORN_DOWN_EVENT_TYPE,
  CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE,
] as const;
export type SsoConnectionEventType =
  (typeof SSO_CONNECTION_EVENT_TYPES)[number];

export const SSO_CONNECTION_EVENT_VERSION_LATEST = "2026-08-24" as const;

/** Every connection fact carries where it came from, so a grandfathered
 *  history is legible without joining anything. */
const sourced = { source: ssoConnectionSourceSchema };

export const connectionRegisteredPayloadSchema = z.object({
  connectionId: z.string().min(1),
  organizationId: z.string().min(1),
  type: ssoConnectionTypeSchema,
  idp: ssoIdpMetadataSchema,
  /** What this connection does with somebody it has never seen. */
  arrivalPolicy: ssoArrivalPolicySchema,
  actor: identityActorSchema,
  ...sourced,
});

export const domainClaimedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  domain: z.string().min(1),
  actor: identityActorSchema,
  ...sourced,
});

export const domainClaimApprovedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  domain: z.string().min(1),
  /** The ops user who approved. Recorded because first-verifier-owns makes
   *  this step the abuse boundary (D04 Security Concerns). */
  actor: identityActorSchema,
  /**
   * What authorized the approval (D05 tier 2). Defaults to the operator so
   * every fact written before tier 2 existed decodes as what it was; an
   * approval a licence authorized says so, permanently.
   */
  authority: ssoDomainClaimAuthoritySchema.default("platform-operator"),
  ...sourced,
});

export const domainClaimRejectedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  domain: z.string().min(1),
  /** Why ops said no, in the operator's words. Read back on re-claim. */
  note: z.string().min(1),
  actor: identityActorSchema,
  ...sourced,
});

export const connectionDiscardedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  actor: identityActorSchema,
  ...sourced,
});

export const verificationRequestedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  domain: z.string().min(1),
  method: ssoVerificationMethodSchema,
  /** `sha256:…` of the token the operator publishes. The token itself is
   *  shown once and never recorded — a log that carried it would let anyone
   *  with read access to history satisfy someone else's ceremony. */
  tokenHash: z.string().min(1),
  /**
   * When the published record stops proving anything, or null for a ceremony
   * that does not expire. Nullable with a default so every ceremony fact
   * written before D05 decodes as the open-ended one it was.
   *
   * A deadline rather than a sweep: nothing deletes an expired ceremony, the
   * guard simply refuses to read it as a proof. Asking again issues a fresh
   * record against the same approved claim, so an expiry costs a customer a
   * click and never their place in the queue.
   */
  expiresAtMs: z.number().int().nonnegative().nullable().default(null),
  actor: identityActorSchema,
  ...sourced,
});

/**
 * A LangWatch operator stating out of band that a domain is that
 * organization's (D05 amendment). Its OWN fact rather than a
 * `verification_requested` carrying a nullable `tokenHash`, because there is
 * no token: an attestation publishes nothing, so nothing was ever shown to
 * anybody to hash. A nullable hash would also make a `dns-txt` request
 * without a proof structurally representable, moving an invariant the schema
 * enforces today onto a runtime check.
 *
 * It is also one step rather than two — APPROVED straight to VERIFIED —
 * because there is nothing to wait for between them.
 */
export const domainAttestedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  domain: z.string().min(1),
  /** The platform operator who attested. Recorded because an attested domain
   *  is exactly as trustworthy as the operator behind it, and a dispute is
   *  answered from this fact. */
  actor: identityActorSchema,
  ...sourced,
});

/**
 * A domain taken back out of the connection, by whoever manages it. The
 * fact carries only the domain and the actor: everything the domain had —
 * claims, approvals, verifications, a pending ceremony — is derived state
 * the fold recomputes without it, while the history keeps every step that
 * was taken.
 */
export const domainWithdrawnPayloadSchema = z.object({
  connectionId: z.string().min(1),
  domain: z.string().min(1),
  actor: identityActorSchema,
  ...sourced,
});

export const domainVerifiedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  domain: z.string().min(1),
  method: ssoVerificationMethodSchema,
  actor: identityActorSchema,
  ...sourced,
});

/**
 * A re-check found the record gone (ADR-123). Stated once, when the evidence
 * first goes missing — a second check that finds it still missing states
 * nothing, because nothing about the world has changed and a fact per check
 * would bury the two that matter under thousands that do not.
 *
 * `graceEndsAtMs` rides on the fact rather than being recomputed at read
 * time, for the reason the teardown deadline does: the deadline a customer
 * was TOLD is the deadline they get, and shortening the grace window later
 * must not silently move a clock that is already running.
 */
export const domainProofWaveredPayloadSchema = z.object({
  connectionId: z.string().min(1),
  domain: z.string().min(1),
  /** When the record was first found missing. The clock starts here. */
  firstAbsentAtMs: z.number().int().nonnegative(),
  /** When continued absence becomes a lapse. */
  graceEndsAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
  ...sourced,
});

/**
 * The grace ran out with the record still missing (ADR-123). What changes is
 * narrow and stated here so a reader never has to infer it: the domain stops
 * vouching for NEW people. It does not suspend the connection, does not stop
 * a single existing member signing in, and does not un-prove anything —
 * `verifiedDomains` is untouched, because routing is untouched.
 */
export const domainProofLapsedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  domain: z.string().min(1),
  /** Carried forward so the fact says how long it was gone before we acted,
   *  without a reader having to find the wavering fact to know. */
  firstAbsentAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
  ...sourced,
});

/**
 * The record is published again (ADR-123). Recovery costs the customer
 * nothing but publishing it: no re-claim, no fresh token, no queue — the
 * domain was never un-proved, only doubted.
 */
export const domainProofRecoveredPayloadSchema = z.object({
  connectionId: z.string().min(1),
  domain: z.string().min(1),
  /** How long the evidence was missing, end to end. The number an operator
   *  answers "how long were they exposed" with. */
  absentForMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
  ...sourced,
});

export const connectionActivatedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  /** The account whose successful test login the activation rests on; null
   *  only for a grandfathered connection, whose test login is the years of
   *  production sign-ins the strings already served. */
  testLoginAccountId: z.string().min(1).nullable(),
  actor: identityActorSchema,
  ...sourced,
});

export const connectionSuspendedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  reason: z.string().min(1).nullable(),
  actor: identityActorSchema,
  ...sourced,
});

export const connectionResumedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  actor: identityActorSchema,
  ...sourced,
});

export const teardownRequestedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  reason: z.string().min(1).nullable(),
  /** When the grace expires. The process manager wakes at this instant and
   *  dispatches the completion command; carrying it on the fact is what
   *  lets a replay reconstruct the deadline without a second store. */
  tearDownAfterMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
  ...sourced,
});

export const connectionTornDownPayloadSchema = z.object({
  connectionId: z.string().min(1),
  actor: identityActorSchema,
  ...sourced,
});

export const connectionArrivalPolicySetPayloadSchema = z.object({
  connectionId: z.string().min(1),
  policy: ssoArrivalPolicySchema,
  actor: identityActorSchema,
  ...sourced,
});

/**
 * A connection fact as a command decides it. The framework envelope
 * (aggregate, tenant, ids, idempotency key) and `occurredAt` are stamped by
 * whoever appends.
 */
export const ssoConnectionFactInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(CONNECTION_REGISTERED_EVENT_TYPE),
    data: connectionRegisteredPayloadSchema,
  }),
  z.object({
    type: z.literal(DOMAIN_CLAIMED_EVENT_TYPE),
    data: domainClaimedPayloadSchema,
  }),
  z.object({
    type: z.literal(DOMAIN_CLAIM_APPROVED_EVENT_TYPE),
    data: domainClaimApprovedPayloadSchema,
  }),
  z.object({
    type: z.literal(DOMAIN_CLAIM_REJECTED_EVENT_TYPE),
    data: domainClaimRejectedPayloadSchema,
  }),
  z.object({
    type: z.literal(CONNECTION_DISCARDED_EVENT_TYPE),
    data: connectionDiscardedPayloadSchema,
  }),
  z.object({
    type: z.literal(VERIFICATION_REQUESTED_EVENT_TYPE),
    data: verificationRequestedPayloadSchema,
  }),
  z.object({
    type: z.literal(DOMAIN_ATTESTED_EVENT_TYPE),
    data: domainAttestedPayloadSchema,
  }),
  z.object({
    type: z.literal(DOMAIN_WITHDRAWN_EVENT_TYPE),
    data: domainWithdrawnPayloadSchema,
  }),
  z.object({
    type: z.literal(DOMAIN_VERIFIED_EVENT_TYPE),
    data: domainVerifiedPayloadSchema,
  }),
  z.object({
    type: z.literal(DOMAIN_PROOF_WAVERED_EVENT_TYPE),
    data: domainProofWaveredPayloadSchema,
  }),
  z.object({
    type: z.literal(DOMAIN_PROOF_LAPSED_EVENT_TYPE),
    data: domainProofLapsedPayloadSchema,
  }),
  z.object({
    type: z.literal(DOMAIN_PROOF_RECOVERED_EVENT_TYPE),
    data: domainProofRecoveredPayloadSchema,
  }),
  z.object({
    type: z.literal(CONNECTION_ACTIVATED_EVENT_TYPE),
    data: connectionActivatedPayloadSchema,
  }),
  z.object({
    type: z.literal(CONNECTION_SUSPENDED_EVENT_TYPE),
    data: connectionSuspendedPayloadSchema,
  }),
  z.object({
    type: z.literal(CONNECTION_RESUMED_EVENT_TYPE),
    data: connectionResumedPayloadSchema,
  }),
  z.object({
    type: z.literal(TEARDOWN_REQUESTED_EVENT_TYPE),
    data: teardownRequestedPayloadSchema,
  }),
  z.object({
    type: z.literal(CONNECTION_TORN_DOWN_EVENT_TYPE),
    data: connectionTornDownPayloadSchema,
  }),
  z.object({
    type: z.literal(CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE),
    data: connectionArrivalPolicySetPayloadSchema,
  }),
]);
export type SsoConnectionFactInput = z.infer<
  typeof ssoConnectionFactInputSchema
>;

/** A fact with its business time — what the reducer folds. */
export type SsoConnectionFact = SsoConnectionFactInput & { occurredAt: number };

// ---- folded state --------------------------------------------------------

/**
 * What proved one domain, kept per domain and forever (D05 amendment). The
 * price of an attestation standing indefinitely is that the weaker evidence
 * must never become invisible, so the method rides on the connection itself
 * rather than only in the log: every surface that reads a connection reads
 * this too, and an attested domain cannot be presented as one the customer
 * proved.
 */
export interface SsoDomainVerification {
  domain: string;
  method: SsoVerificationMethod;
  /** Who proved it — the attesting operator, or whoever ran the ceremony.
   *  Null for a system actor, which is what the grandfather migration is. */
  actorId: string | null;
  verifiedAtMs: number;
  /**
   * Whether the evidence is still there (ADR-123). Defaults to `VERIFIED` so
   * every proof recorded before re-verification existed decodes as what it
   * was: a domain nothing had contradicted.
   */
  proofState: SsoDomainProofState;
  /** When the record was first found missing; null while it is there. */
  firstAbsentAtMs: number | null;
  /** When continued absence becomes a lapse; null while it is there. The
   *  deadline the customer was told, kept rather than recomputed. */
  graceEndsAtMs: number | null;
  /**
   * `sha256:…` of the token the ceremony published, carried forward from the
   * ceremony that proved this domain so a LATER read can recognise the very
   * record the customer put up (ADR-123).
   *
   * The token itself is still never kept — this is the same hash the
   * ceremony recorded, and it is what makes a re-read verification rather
   * than "is anything at all published at our name". Null for every proof no
   * record made, and for every domain proved before re-verification existed:
   * a re-read that cannot compare a value is not evidence of anything, so
   * those domains are not re-read at all.
   */
  tokenHash: string | null;
}

/**
 * One connection as the projection knows it — one row of `SsoConnection`,
 * and the state every guard is evaluated against.
 */
/**
 * One domain claim, from the moment it was made to the moment it was
 * decided — the tier-3 queue's row, and the answer to "how long did this
 * customer wait" long after the wait is over.
 *
 * Kept per domain on the connection rather than derived from the log at read
 * time, because the queue is read constantly and a replay of every
 * connection's history to sort a list is not a queue. The log stays the
 * arbiter; this is its head.
 *
 * `waitedMs` is RECORDED rather than computed from the two timestamps,
 * because a domain may be claimed again after a rejection and the second
 * claim overwrites the first one's clock. What the queue's latency was is a
 * measurement, and a measurement that a later action can silently rewrite is
 * not one (epic Open Q2: measure queue latency from day one).
 */
export interface SsoDomainClaim {
  domain: string;
  state: SsoDomainClaimState;
  /** When the claim was made. The queue's clock starts here. */
  claimedAtMs: number;
  claimedByActorId: string | null;
  /** When it was decided; null while it is still waiting. */
  decidedAtMs: number | null;
  decidedByActorId: string | null;
  /** What authorized the decision; null while it is still waiting. */
  authority: SsoDomainClaimAuthority | null;
  /** How long the claim waited to be decided, in milliseconds. */
  waitedMs: number | null;
  /** The reviewer's words, on a rejection. Read back on a re-claim. */
  note: string | null;
}

export interface SsoConnectionState {
  connectionId: string;
  organizationId: string;
  type: SsoConnectionType;
  state: SsoConnectionLifecycleState;
  /** Claimed but not yet approved. */
  claimedDomains: string[];
  /** Every claim this connection has ever made, in the order they were made:
   *  where each stands, when it was made, and how long it waited. */
  domainClaims: SsoDomainClaim[];
  /** Approved by ops, not yet proved. */
  approvedDomains: string[];
  /** Proved, and the only ones that ever route. */
  verifiedDomains: string[];
  /** What proved each of them, and who. One entry per verified domain. */
  domainVerifications: SsoDomainVerification[];
  /** The ceremony in flight, if any. The token's hash, never the token. */
  pendingVerification: {
    domain: string;
    method: SsoVerificationMethod;
    tokenHash: string;
    /** When the published record stops proving anything; null when the
     *  ceremony does not expire. */
    expiresAtMs: number | null;
  } | null;
  idpMetadata: SsoIdpMetadata;
  /** Who this connection admits (ADR-117 §3). Stated at registration and
   *  changed by the setup journey; never absent, so no reader has to decide
   *  what absence means. */
  arrivalPolicy: SsoArrivalPolicy;
  /**
   * When somebody CHOSE it, or null while the registration default stands.
   *
   * A different fact from the policy, not a second copy of it: a connection
   * always has a behaviour, and separately somebody has or has not decided
   * on it. Going live waits for the deciding — "turn everybody away" is a
   * decision too — and the screen can say when it was made and stop asking.
   */
  arrivalPolicyDecidedAtMs: number | null;
  source: SsoConnectionSource;
  testLoginAccountId: string | null;
  /** Why ops last rejected a claim, with the domain it was about. Kept so a
   *  re-claim starts from what a human already said. */
  rejection: { domain: string; note: string } | null;
  createdBy: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  /** When the grace elapses, while TEARDOWN_PENDING. */
  tearDownAfterMs: number | null;
}

const EMPTY_IDP: SsoIdpMetadata = {
  issuer: null,
  providerId: "",
  clientIdRef: null,
  secretRef: null,
  certRefs: [],
};

export function emptySsoConnection({
  connectionId,
}: {
  connectionId: string;
}): SsoConnectionState {
  return {
    connectionId,
    organizationId: "",
    type: "oidc",
    state: "DRAFT",
    claimedDomains: [],
    domainClaims: [],
    approvedDomains: [],
    verifiedDomains: [],
    domainVerifications: [],
    pendingVerification: null,
    idpMetadata: EMPTY_IDP,
    arrivalPolicy: DEFAULT_SSO_ARRIVAL_POLICY,
    arrivalPolicyDecidedAtMs: null,
    source: "self-serve",
    testLoginAccountId: null,
    rejection: null,
    createdBy: null,
    createdAtMs: 0,
    updatedAtMs: 0,
    tearDownAfterMs: null,
  };
}

/**
 * What a pre-live connection's state is once a domain has been withdrawn:
 * whatever its REMAINING domains have earned, in the lifecycle's own order.
 * A connection past VERIFIED (ACTIVE, SUSPENDED, on its way out) keeps its
 * state — routing is not re-decided by tidying a domain list.
 */
/**
 * The lifecycle state after a fact about ONE DOMAIN.
 *
 * A connection's lifecycle and its domains are two different things, and past
 * VERIFIED only the lifecycle verbs may move the lifecycle. Claiming a second
 * domain on a LIVE connection stated `state: "CLAIMED"`, which
 * `routingStateOf` reads as INACTIVE — so an administrator adding a
 * subsidiary's domain stopped everybody on the already-proved domain from
 * being routed to their identity provider, and getting back required proving
 * the new domain and activating again. Nothing said so.
 *
 * The same set `stateAfterWithdrawal` uses, for the same reason: withdrawal
 * already knew that a domain leaving must not un-live a connection, and every
 * other domain fact needed to know it too.
 */
function lifecycleAfterDomainFact(
  state: {
    state: SsoConnectionLifecycleState;
    verifiedDomains: string[];
  },
  proposed: SsoConnectionLifecycleState,
): SsoConnectionLifecycleState {
  if (LIFECYCLE_BEYOND_VERIFIED.includes(state.state)) return state.state;
  // AND NOT BELOW WHAT THE REMAINING DOMAINS HAVE ALREADY EARNED, which is
  // the same rule `stateAfterWithdrawal` applies for the same reason: a fact
  // about ONE domain says nothing about another domain's proof. Stopping at
  // "beyond VERIFIED" left VERIFIED itself unprotected, so a connection that
  // had proved a domain and claimed a second one dropped to CLAIMED — and
  // `activate_connection` accepts VERIFIED and nothing else, so the customer
  // could no longer go live with the domain they had already proved.
  if (state.verifiedDomains.length > 0) return "VERIFIED";
  return proposed;
}

/** Past these, a domain fact never moves the lifecycle. */
const LIFECYCLE_BEYOND_VERIFIED: SsoConnectionLifecycleState[] = [
  "ACTIVE",
  "SUSPENDED",
  "TEARDOWN_PENDING",
  "TORN_DOWN",
  "DISCARDED",
];

function stateAfterWithdrawal(state: {
  state: SsoConnectionLifecycleState;
  verifiedDomains: string[];
  approvedDomains: string[];
  pendingVerification: { domain: string } | null;
  domainClaims: SsoDomainClaim[];
}): SsoConnectionLifecycleState {
  if (LIFECYCLE_BEYOND_VERIFIED.includes(state.state)) return state.state;
  if (state.verifiedDomains.length > 0) return "VERIFIED";
  if (state.pendingVerification !== null) return "VERIFICATION_PENDING";
  if (state.approvedDomains.length > 0) return "APPROVED";
  if (state.domainClaims.some((claim) => claim.state === "WAITING")) {
    return "CLAIMED";
  }
  if (state.domainClaims.some((claim) => claim.state === "REJECTED")) {
    return "REJECTED";
  }
  return "DRAFT";
}

const without = (domains: string[], domain: string): string[] =>
  domains.filter((held) => held !== domain);

const withDomain = (domains: string[], domain: string): string[] =>
  domains.includes(domain) ? domains : [...domains, domain];

/**
 * One claim row per domain, last claim wins. A domain claimed again after a
 * rejection REPLACES its row: the queue lists one claim per domain, and the
 * earlier attempt with the reviewer's note stays in the event log, which is
 * where a dispute reads it.
 */
const withClaim = (
  held: SsoDomainClaim[],
  claim: SsoDomainClaim,
): SsoDomainClaim[] => [
  ...held.filter((entry) => entry.domain !== claim.domain),
  claim,
];

/** Decide the waiting claim on a domain, leaving every other row alone. A
 *  decision on a domain with no waiting claim changes nothing — the guards
 *  refuse that before any fact exists. */
const decideClaim = (
  held: SsoDomainClaim[],
  decision: {
    domain: string;
    state: Exclude<SsoDomainClaimState, "WAITING">;
    decidedAtMs: number;
    decidedByActorId: string | null;
    authority: SsoDomainClaimAuthority;
    note: string | null;
  },
): SsoDomainClaim[] =>
  held.map((entry) =>
    entry.domain === decision.domain
      ? {
          ...entry,
          state: decision.state,
          decidedAtMs: decision.decidedAtMs,
          decidedByActorId: decision.decidedByActorId,
          authority: decision.authority,
          waitedMs: Math.max(0, decision.decidedAtMs - entry.claimedAtMs),
          note: decision.note,
        }
      : entry,
  );

/** One proof per domain, last one wins — a domain re-proved by a later
 *  ceremony is described by what proved it most recently, and the earlier
 *  proof stays in the event log where a dispute reads it. */
const withVerification = (
  held: SsoDomainVerification[],
  verification: SsoDomainVerification,
): SsoDomainVerification[] => [
  ...held.filter((entry) => entry.domain !== verification.domain),
  verification,
];

/**
 * Change what one domain's proof SAYS about itself, leaving what proved it
 * alone (ADR-123). A waver, a lapse and a recovery are all statements about
 * the evidence's condition — never about the method, the prover or the date —
 * so they map the row rather than replacing it, and an attested domain that
 * wavers is still an attested domain afterwards.
 *
 * A statement about a domain with no proof changes nothing. The guards refuse
 * that before any fact exists.
 */
const withProofCondition = (
  held: SsoDomainVerification[],
  condition: {
    domain: string;
    proofState: SsoDomainProofState;
    firstAbsentAtMs: number | null;
    graceEndsAtMs: number | null;
  },
): SsoDomainVerification[] =>
  held.map((entry) =>
    entry.domain === condition.domain
      ? {
          ...entry,
          proofState: condition.proofState,
          firstAbsentAtMs: condition.firstAbsentAtMs,
          graceEndsAtMs: condition.graceEndsAtMs,
        }
      : entry,
  );

/**
 * The reducer. Pure and total: every fact answers a next state, and the
 * same function runs in the framework's fold, in the replay proof and in a
 * browser tab. A fact the state machine forbids never reaches here — the
 * guards refuse before any fact exists — so this file states transitions
 * rather than re-checking them.
 */
export function reduceSsoConnection({
  state,
  fact,
}: {
  state: SsoConnectionState;
  fact: SsoConnectionFact;
}): SsoConnectionState {
  const touched = { ...state, updatedAtMs: fact.occurredAt };
  switch (fact.type) {
    case CONNECTION_REGISTERED_EVENT_TYPE:
      return {
        ...touched,
        connectionId: fact.data.connectionId,
        organizationId: fact.data.organizationId,
        type: fact.data.type,
        state: "DRAFT",
        idpMetadata: fact.data.idp,
        arrivalPolicy: fact.data.arrivalPolicy,
        source: fact.data.source,
        createdBy: fact.data.actor.id,
        createdAtMs: fact.occurredAt,
      };
    case DOMAIN_CLAIMED_EVENT_TYPE:
      return {
        ...touched,
        state: lifecycleAfterDomainFact(state, "CLAIMED"),
        claimedDomains: withDomain(state.claimedDomains, fact.data.domain),
        domainClaims: withClaim(state.domainClaims, {
          domain: fact.data.domain,
          state: "WAITING",
          claimedAtMs: fact.occurredAt,
          claimedByActorId: fact.data.actor.id,
          decidedAtMs: null,
          decidedByActorId: null,
          authority: null,
          waitedMs: null,
          note: null,
        }),
        rejection: null,
      };
    case DOMAIN_CLAIM_APPROVED_EVENT_TYPE:
      return {
        ...touched,
        state: lifecycleAfterDomainFact(state, "APPROVED"),
        claimedDomains: without(state.claimedDomains, fact.data.domain),
        approvedDomains: withDomain(state.approvedDomains, fact.data.domain),
        domainClaims: decideClaim(state.domainClaims, {
          domain: fact.data.domain,
          state: "APPROVED",
          decidedAtMs: fact.occurredAt,
          decidedByActorId: fact.data.actor.id,
          authority: fact.data.authority,
          note: null,
        }),
      };
    case DOMAIN_CLAIM_REJECTED_EVENT_TYPE:
      return {
        ...touched,
        state: lifecycleAfterDomainFact(state, "REJECTED"),
        claimedDomains: without(state.claimedDomains, fact.data.domain),
        domainClaims: decideClaim(state.domainClaims, {
          domain: fact.data.domain,
          state: "REJECTED",
          decidedAtMs: fact.occurredAt,
          decidedByActorId: fact.data.actor.id,
          authority: "platform-operator",
          note: fact.data.note,
        }),
        rejection: { domain: fact.data.domain, note: fact.data.note },
      };
    case CONNECTION_DISCARDED_EVENT_TYPE:
      return { ...touched, state: "DISCARDED" };
    // A domain taken back out: every trace of it leaves the derived state —
    // claims, approvals, verifications, the pending ceremony if it was its —
    // and the connection's own state falls back to whatever the REMAINING
    // domains have earned. The history keeps every step; only the state
    // stops saying the domain is here.
    case DOMAIN_WITHDRAWN_EVENT_TYPE: {
      const domain = fact.data.domain;
      const withdrawn = {
        ...touched,
        claimedDomains: without(state.claimedDomains, domain),
        approvedDomains: without(state.approvedDomains, domain),
        verifiedDomains: without(state.verifiedDomains, domain),
        domainClaims: state.domainClaims.filter(
          (claim) => claim.domain !== domain,
        ),
        domainVerifications: state.domainVerifications.filter(
          (verification) => verification.domain !== domain,
        ),
        pendingVerification:
          state.pendingVerification?.domain === domain
            ? null
            : state.pendingVerification,
        rejection: state.rejection?.domain === domain ? null : state.rejection,
      };
      return { ...withdrawn, state: stateAfterWithdrawal(withdrawn) };
    }
    case VERIFICATION_REQUESTED_EVENT_TYPE:
      return {
        ...touched,
        state: lifecycleAfterDomainFact(state, "VERIFICATION_PENDING"),
        pendingVerification: {
          domain: fact.data.domain,
          method: fact.data.method,
          tokenHash: fact.data.tokenHash,
          expiresAtMs: fact.data.expiresAtMs,
        },
      };
    // Attestation is one step, not two: there is nothing to wait for between
    // the operator deciding and the domain being proved, so it folds exactly
    // as a verification does — and records its own method, permanently.
    case DOMAIN_ATTESTED_EVENT_TYPE:
      return {
        ...touched,
        state: lifecycleAfterDomainFact(state, "VERIFIED"),
        approvedDomains: without(state.approvedDomains, fact.data.domain),
        verifiedDomains: withDomain(state.verifiedDomains, fact.data.domain),
        domainVerifications: withVerification(state.domainVerifications, {
          domain: fact.data.domain,
          method: "operator-attested",
          actorId: fact.data.actor.id,
          verifiedAtMs: fact.occurredAt,
          proofState: "VERIFIED",
          firstAbsentAtMs: null,
          graceEndsAtMs: null,
          // An attestation publishes nothing, so there is no record to read
          // again and nothing to read it against.
          tokenHash: null,
        }),
        pendingVerification: null,
      };
    case DOMAIN_VERIFIED_EVENT_TYPE:
      return {
        ...touched,
        state: lifecycleAfterDomainFact(state, "VERIFIED"),
        approvedDomains: without(state.approvedDomains, fact.data.domain),
        verifiedDomains: withDomain(state.verifiedDomains, fact.data.domain),
        domainVerifications: withVerification(state.domainVerifications, {
          domain: fact.data.domain,
          method: fact.data.method,
          actorId: fact.data.actor.id,
          verifiedAtMs: fact.occurredAt,
          // A domain proved again is a domain nothing is doubting: re-proving
          // through the ceremony clears a waver or a lapse in the same
          // stroke, which is what makes "publish it again" the whole remedy.
          proofState: "VERIFIED",
          firstAbsentAtMs: null,
          graceEndsAtMs: null,
          // Carried forward from the ceremony this fact closes, which is the
          // one moment the hash is in hand. Derived from the folded state
          // rather than from the fact, so a replay reconstructs it identically
          // and no payload has to grow a field that is already known here.
          tokenHash:
            state.pendingVerification?.domain === fact.data.domain &&
            state.pendingVerification.method === "dns-txt"
              ? state.pendingVerification.tokenHash
              : null,
        }),
        pendingVerification: null,
      };
    // The three condition facts (ADR-123). None of them touches `state`,
    // `verifiedDomains` or anything routing reads: what they change is what
    // the evidence SAYS, and the only behaviour hanging off that is whether
    // the domain vouches for somebody NEW.
    case DOMAIN_PROOF_WAVERED_EVENT_TYPE:
      return {
        ...touched,
        domainVerifications: withProofCondition(state.domainVerifications, {
          domain: fact.data.domain,
          proofState: "WAVERING",
          firstAbsentAtMs: fact.data.firstAbsentAtMs,
          graceEndsAtMs: fact.data.graceEndsAtMs,
        }),
      };
    case DOMAIN_PROOF_LAPSED_EVENT_TYPE:
      return {
        ...touched,
        domainVerifications: withProofCondition(state.domainVerifications, {
          domain: fact.data.domain,
          proofState: "LAPSED",
          firstAbsentAtMs: fact.data.firstAbsentAtMs,
          // The deadline has passed, so there is no longer one to keep.
          graceEndsAtMs: null,
        }),
      };
    case DOMAIN_PROOF_RECOVERED_EVENT_TYPE:
      return {
        ...touched,
        domainVerifications: withProofCondition(state.domainVerifications, {
          domain: fact.data.domain,
          proofState: "VERIFIED",
          firstAbsentAtMs: null,
          graceEndsAtMs: null,
        }),
      };
    case CONNECTION_ACTIVATED_EVENT_TYPE:
      return {
        ...touched,
        state: "ACTIVE",
        testLoginAccountId: fact.data.testLoginAccountId,
      };
    case CONNECTION_SUSPENDED_EVENT_TYPE:
      return { ...touched, state: "SUSPENDED" };
    case CONNECTION_RESUMED_EVENT_TYPE:
      return { ...touched, state: "ACTIVE" };
    case TEARDOWN_REQUESTED_EVENT_TYPE:
      return {
        ...touched,
        state: "TEARDOWN_PENDING",
        tearDownAfterMs: fact.data.tearDownAfterMs,
      };
    case CONNECTION_TORN_DOWN_EVENT_TYPE:
      return { ...touched, state: "TORN_DOWN", tearDownAfterMs: null };
    case CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE:
      return {
        ...touched,
        arrivalPolicy: fact.data.policy,
        arrivalPolicyDecidedAtMs: fact.occurredAt,
      };
  }
}

/** Who this connection admits. */
export function ssoArrivalPolicy(state: SsoConnectionState): SsoArrivalPolicy {
  return state.arrivalPolicy;
}

// ---- claims and ceremonies, read ------------------------------------------

/**
 * The claims on one connection that are still waiting for LangWatch (D05
 * tier 3). Pure, so the queue's ordering rule is one function the surface,
 * the read model and a test all share.
 */
export function waitingDomainClaims(
  state: SsoConnectionState,
): SsoDomainClaim[] {
  return state.domainClaims.filter((claim) => claim.state === "WAITING");
}

/**
 * How long a claim has waited: the recorded wait once it is decided, and the
 * wait so far while it is not. Longest first is the queue's order, and this
 * is the number it sorts on.
 */
export function domainClaimWaitedMs({
  claim,
  nowMs,
}: {
  claim: SsoDomainClaim;
  nowMs: number;
}): number {
  if (claim.waitedMs !== null) return claim.waitedMs;
  return Math.max(0, nowMs - claim.claimedAtMs);
}

/** The claim on one domain, or null when the connection never made one. */
export function domainClaimFor({
  state,
  domain,
}: {
  state: SsoConnectionState;
  domain: string;
}): SsoDomainClaim | null {
  return state.domainClaims.find((claim) => claim.domain === domain) ?? null;
}

/**
 * One waiting claim, as the tier-3 approval queue lists it.
 *
 * Its own shape rather than the claim plus a connection, because what an
 * operator needs to decide one is exactly this: whose domain, on whose
 * connection, asked for when, and how long they have been waiting for us.
 */
export interface SsoDomainClaimQueueEntry {
  connectionId: string;
  organizationId: string;
  domain: string;
  claimedAtMs: number;
  claimedByActorId: string | null;
  /** How long it has waited so far, at the moment the queue was read. */
  waitedMs: number;
  /** The organization that already proved this domain, which is the whole
   *  reason the claim is a person's to decide; null on a claim nobody
   *  contests, which no longer reaches an operator at all. */
  disputedWithOrganizationId: string | null;
}

/**
 * The queue, longest wait first (D05 tier 3).
 *
 * Pure, so the ordering rule is one function the read repository, the
 * operator surface and a test all share — and so the number the epic's Open
 * Q2 wants measured is computed in exactly one place.
 */
function domainClaimQueue({
  connections,
  nowMs,
}: {
  connections: readonly SsoConnectionState[];
  nowMs: number;
}): SsoDomainClaimQueueEntry[] {
  return connections
    .flatMap((connection) =>
      waitingDomainClaims(connection).map((claim) => ({
        connectionId: connection.connectionId,
        organizationId: connection.organizationId,
        domain: claim.domain,
        claimedAtMs: claim.claimedAtMs,
        claimedByActorId: claim.claimedByActorId,
        waitedMs: domainClaimWaitedMs({ claim, nowMs }),
        disputedWithOrganizationId: null,
      })),
    )
    .sort((left, right) => right.waitedMs - left.waitedMs);
}

/**
 * The queue an operator actually works: the waiting claims on a domain some
 * OTHER organization has already proved.
 *
 * Everything else was taken off a person's desk when the published record
 * became the decision — an uncontested claim is finished by the customer
 * publishing DNS, and listing it would be listing work nobody has to do. A
 * dispute is the one question a record cannot answer, because both sides can
 * publish one only if one of them controls the domain, and by then the
 * argument is about which organization the domain belongs to rather than
 * about DNS.
 *
 * `verifiedElsewhere` maps a domain to the organization already holding it,
 * which the caller reads from wherever domains are held. A claim by that same
 * organization is not a dispute with itself and is dropped, so the answer is
 * the same whether or not the caller filtered first.
 */
export function disputedDomainClaimQueue({
  connections,
  nowMs,
  verifiedElsewhere,
}: {
  connections: readonly SsoConnectionState[];
  nowMs: number;
  verifiedElsewhere: ReadonlyMap<string, string>;
}): SsoDomainClaimQueueEntry[] {
  return domainClaimQueue({ connections, nowMs }).flatMap((entry) => {
    const holder = verifiedElsewhere.get(entry.domain);
    if (holder === undefined || holder === entry.organizationId) return [];
    return [{ ...entry, disputedWithOrganizationId: holder }];
  });
}

// ---- the condition of a proof, read ---------------------------------------

/** What proved one domain and whether that evidence is still there, or null
 *  when the connection never proved it. */
export function domainProofFor({
  state,
  domain,
}: {
  state: SsoConnectionState;
  domain: string;
}): SsoDomainVerification | null {
  return (
    state.domainVerifications.find((entry) => entry.domain === domain) ?? null
  );
}

/**
 * Whether this domain still vouches for somebody NEW (ADR-123).
 *
 * The one question the whole re-verification arc exists to answer, in one
 * function, so provisioning on first sign-in and joining by domain cannot
 * drift apart about what a lapse means. A domain nothing has contradicted
 * vouches; one whose record went missing this morning still vouches, because
 * a waver is a warning and not a punishment; one whose record stayed missing
 * through the grace window does not.
 *
 * Deliberately says nothing about signing IN. Everybody already here keeps
 * their way in whatever this answers, which is why no caller of this is on
 * the sign-in path.
 */
export function domainVouchesForNewPeople({
  state,
  domain,
}: {
  state: SsoConnectionState;
  domain: string;
}): boolean {
  if (!state.verifiedDomains.includes(domain)) return false;
  return domainProofFor({ state, domain })?.proofState !== "LAPSED";
}

/** The domains whose evidence went missing and stayed missing. What the
 *  projection stores alongside `verifiedDomains` so the join and provisioning
 *  reads can ask in one query rather than folding a history each time. */
export function lapsedDomains(state: SsoConnectionState): string[] {
  return state.domainVerifications
    .filter((entry) => entry.proofState === "LAPSED")
    .map((entry) => entry.domain);
}

/** The domains whose evidence is missing and whose grace has not run out —
 *  the ones an administrator has been emailed about and can still fix at no
 *  cost at all. */
function waveringDomains(state: SsoConnectionState): string[] {
  return state.domainVerifications
    .filter((entry) => entry.proofState === "WAVERING")
    .map((entry) => entry.domain);
}

/**
 * Whether the ceremony in flight has passed its expiry. An expired record
 * proves nothing — the guard refuses to read it as a proof — and nothing
 * deletes it, so the customer sees the record they were given until they ask
 * for a fresh one.
 */
export function verificationHasExpired({
  pending,
  nowMs,
}: {
  pending: SsoConnectionState["pendingVerification"];
  nowMs: number;
}): boolean {
  if (!pending || pending.expiresAtMs === null) return false;
  return nowMs > pending.expiresAtMs;
}

// ---- routing projection --------------------------------------------------

/**
 * The lifecycle as ROUTING sees it (`SsoConnectionRoutingState`). Only an
 * ACTIVE connection serves traffic; SUSPENDED is the paused state the
 * guidance screens name; everything else is simply not a door.
 */
export function routingStateOf(
  state: SsoConnectionLifecycleState,
): RoutableConnection["state"] {
  if (state === "ACTIVE") return "ACTIVE";
  if (state === "SUSPENDED") return "SUSPENDED";
  return "INACTIVE";
}

/**
 * What the routing comparison actually judges.
 *
 * Deliberately NOT the connection id: the legacy port answers `org:<id>` and
 * the projection answers a real `ssoc_…`, so comparing ids would report a
 * mismatch for every organization on earth while the sign-in they produce is
 * identical. What matters to a person signing in is whether a door opens,
 * which one, and whether it takes them: the method dialed, the routing state,
 * whether the deployment actually mounted it, and whether an unknown subject
 * gets provisioned.
 */
export interface ConnectionRoutingFacts {
  routes: boolean;
  methodId: string | null;
  state: RoutableConnection["state"] | null;
  configured: boolean | null;
  allowsJit: boolean | null;
}

export function routingFactsOf(
  connection: RoutableConnection | null,
): ConnectionRoutingFacts {
  if (!connection) {
    return {
      routes: false,
      methodId: null,
      state: null,
      configured: null,
      allowsJit: null,
    };
  }
  return {
    routes: true,
    methodId: connection.method.id,
    state: connection.state,
    configured: connection.configured,
    allowsJit: connection.allowsJit,
  };
}

export interface ConnectionRoutingComparison {
  matches: boolean;
  legacy: ConnectionRoutingFacts;
  connection: ConnectionRoutingFacts;
}

/**
 * The one comparison the grandfather pass runs before it finalizes a tenant
 * and the grandfather migration runs per domain to earn `finalized`. Pure, so
 * the thing the bake gate counts is the same function the migration's proof
 * calls and a test can enumerate — and so computing it can never be what
 * changes a sign-in.
 */
export function compareConnectionRouting({
  legacy,
  connection,
}: {
  legacy: RoutableConnection | null;
  connection: RoutableConnection | null;
}): ConnectionRoutingComparison {
  const legacyFacts = routingFactsOf(legacy);
  const connectionFacts = routingFactsOf(connection);
  return {
    matches:
      legacyFacts.routes === connectionFacts.routes &&
      legacyFacts.methodId === connectionFacts.methodId &&
      legacyFacts.state === connectionFacts.state &&
      legacyFacts.configured === connectionFacts.configured &&
      legacyFacts.allowsJit === connectionFacts.allowsJit,
    legacy: legacyFacts,
    connection: connectionFacts,
  };
}
