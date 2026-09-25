import { z } from "zod";

import type { RoutableConnection } from "./signin-routing.ts";
import { identityActorSchema } from "./vocabulary.ts";

/**
 * SSO connection vocabulary (ADR-117 §5, D04): states, events, and pure reducer.
 * Isomorphic; secrets carried as refs, not values.
 */

/**
 * Protocol field: aggregate is protocol-agnostic. SAML engine is named debt for D05 (ADR-117).
 */
export const SSO_CONNECTION_TYPES = ["oidc", "saml"] as const;
export const ssoConnectionTypeSchema = z.enum(SSO_CONNECTION_TYPES);
export type SsoConnectionType = z.infer<typeof ssoConnectionTypeSchema>;

/**
 * Connection lifecycle: REJECTED re-claimable; DISCARDED, TORN_DOWN terminal (ADR-117 §5).
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
export type SsoConnectionLifecycleState = z.infer<typeof ssoConnectionStateSchema>;

/**
 * Verification methods: DNS TXT, the file the domain serves, license token,
 * operator-attested (D05), legacy (grandfather).
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
 * What a connection does with somebody who signs in through it and is not a
 * member yet (ADR-117 §3). ONE field: a boolean beside it disagreed about
 * the middle answer, and "they ask, you approve" provisioned nobody.
 */
export const SSO_ARRIVAL_POLICIES = ["admit", "request", "refuse"] as const;
export const ssoArrivalPolicySchema = z.enum(SSO_ARRIVAL_POLICIES);
export type SsoArrivalPolicy = z.infer<typeof ssoArrivalPolicySchema>;

/** What a connection admits before anybody has chosen: the only answer that
 *  cannot surprise anybody. */
export const DEFAULT_SSO_ARRIVAL_POLICY: SsoArrivalPolicy = "refuse";

/** Whether a stored string is one of the three answers. */
export function isSsoArrivalPolicy(value: string): value is SsoArrivalPolicy {
  return SSO_ARRIVAL_POLICIES.some((policy) => policy === value);
}

export const SSO_VERIFICATION_CEREMONY_METHODS = ["dns-txt", "license-token"] as const;
export const ssoVerificationCeremonyMethodSchema = z.enum(SSO_VERIFICATION_CEREMONY_METHODS);
export type SsoVerificationCeremonyMethod = z.infer<typeof ssoVerificationCeremonyMethodSchema>;

/**
 * The two channels one published-proof ceremony can be satisfied through:
 * the same pending ceremony and the same hash, so which one proved it is
 * what the verified fact records, and a re-read looks where it lives.
 */
export const SSO_PUBLISHED_PROOF_CHANNELS = ["dns-txt", "https-file"] as const;
export const ssoPublishedProofChannelSchema = z.enum(SSO_PUBLISHED_PROOF_CHANNELS);
export type SsoPublishedProofChannel = z.infer<typeof ssoPublishedProofChannelSchema>;

/**
 * What authorized a claim's approval (D05 tier 2). Recorded on the fact
 * rather than inferred from the deployment, because a deployment changes and
 * a fact does not: a dispute about a domain is answered from history alone.
 */
export const SSO_DOMAIN_CLAIM_AUTHORITIES = ["platform-operator", "dns-proof"] as const;
export const ssoDomainClaimAuthoritySchema = z.enum(SSO_DOMAIN_CLAIM_AUTHORITIES);
export type SsoDomainClaimAuthority = z.infer<typeof ssoDomainClaimAuthoritySchema>;

/** Where one claim stands. `WITHDRAWN` is a tombstone, not a step: the row
 *  stays so the claim throttle still sees the attempt was made. */
export const SSO_DOMAIN_CLAIM_STATES = ["WAITING", "APPROVED", "REJECTED", "WITHDRAWN"] as const;
export const ssoDomainClaimStateSchema = z.enum(SSO_DOMAIN_CLAIM_STATES);
export type SsoDomainClaimState = z.infer<typeof ssoDomainClaimStateSchema>;

/** Whether a method published something a re-read can go and look for. */
export function isSsoPublishedProofChannel(method: string): method is SsoPublishedProofChannel {
  return SSO_PUBLISHED_PROOF_CHANNELS.some((channel) => channel === method);
}

/**
 * Whether the evidence behind a proved domain is still there (ADR-123).
 * `WAVERING` found the record gone and started a clock; `LAPSED` is that
 * grace spent, which stops it vouching for anybody NEW.
 */
export const SSO_DOMAIN_PROOF_STATES = ["VERIFIED", "WAVERING", "LAPSED"] as const;
export const ssoDomainProofStateSchema = z.enum(SSO_DOMAIN_PROOF_STATES);
export type SsoDomainProofState = z.infer<typeof ssoDomainProofStateSchema>;

/**
 * Where a connection came from. `legacy-grandfathered` is stamped on every
 * migration-emitted event, so an operator can tell human-configured from
 * migration-inferred.
 */
export const SSO_CONNECTION_SOURCES = ["self-serve", "legacy-grandfathered"] as const;
export const ssoConnectionSourceSchema = z.enum(SSO_CONNECTION_SOURCES);
export type SsoConnectionSource = z.infer<typeof ssoConnectionSourceSchema>;

/**
 * Where a direct connection replacing a grandfathered one stands. Routing
 * reads this state; the timestamps beside it are evidence for people and
 * audit logs, never an implicit routing decision.
 */
export const SSO_MIGRATION_PHASES = [
  "SETUP",
  "GRACE_LEGACY",
  "GRACE_DIRECT",
  "FINALIZING",
  "FINALIZED",
] as const;
export const ssoMigrationPhaseSchema = z.enum(SSO_MIGRATION_PHASES);
export type SsoMigrationPhase = z.infer<typeof ssoMigrationPhaseSchema>;

/** Which connection decides an ordinary sign-in while the pair stands. */
export const SSO_MIGRATION_ROUTES = ["legacy", "direct"] as const;
export const ssoMigrationRouteSchema = z.enum(SSO_MIGRATION_ROUTES);
export type SsoMigrationRoute = z.infer<typeof ssoMigrationRouteSchema>;

/** An operator attestation's evidence: a durable reference, and what the operator checked. */
export const ssoAttestationEvidenceRefSchema = z.string().trim().min(1).max(500);
export const ssoAttestationNoteSchema = z.string().trim().min(1).max(1_000);

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

export const CONNECTION_REGISTERED_EVENT_TYPE = "lw.identity.connection_registered" as const;
export const DOMAIN_CLAIMED_EVENT_TYPE = "lw.identity.domain_claimed" as const;
export const DOMAIN_CLAIM_APPROVED_EVENT_TYPE = "lw.identity.domain_claim_approved" as const;
export const DOMAIN_CLAIM_REJECTED_EVENT_TYPE = "lw.identity.domain_claim_rejected" as const;
export const CONNECTION_DISCARDED_EVENT_TYPE = "lw.identity.connection_discarded" as const;
export const VERIFICATION_REQUESTED_EVENT_TYPE = "lw.identity.verification_requested" as const;
export const DOMAIN_ATTESTED_EVENT_TYPE = "lw.identity.domain_attested" as const;
export const DOMAIN_WITHDRAWN_EVENT_TYPE = "lw.identity.domain_withdrawn" as const;
export const DOMAIN_VERIFIED_EVENT_TYPE = "lw.identity.domain_verified" as const;
export const DOMAIN_PROOF_WAVERED_EVENT_TYPE = "lw.identity.domain_proof_wavered" as const;
export const DOMAIN_PROOF_LAPSED_EVENT_TYPE = "lw.identity.domain_proof_lapsed" as const;
export const DOMAIN_PROOF_RECOVERED_EVENT_TYPE = "lw.identity.domain_proof_recovered" as const;
export const CONNECTION_ACTIVATED_EVENT_TYPE = "lw.identity.connection_activated" as const;
export const CONNECTION_SUSPENDED_EVENT_TYPE = "lw.identity.connection_suspended" as const;
export const CONNECTION_RESUMED_EVENT_TYPE = "lw.identity.connection_resumed" as const;
export const TEARDOWN_REQUESTED_EVENT_TYPE = "lw.identity.teardown_requested" as const;
export const CONNECTION_TORN_DOWN_EVENT_TYPE = "lw.identity.connection_torn_down" as const;
/** Who this connection admits, changed after registration stated it. */
/** The word on a connection's card, changed. A NAME AND NOT AN IDENTIFIER:
 *  a sign-in reaches a provider by connection id, so two organizations may
 *  both call theirs `okta`, and no saved link breaks when it changes. */
export const CONNECTION_RENAMED_EVENT_TYPE = "lw.identity.connection_renamed" as const;
export const REPLACEMENT_CONNECTION_REGISTERED_EVENT_TYPE =
  "lw.identity.replacement_connection_registered" as const;
export const MIGRATION_ROUTE_SELECTED_EVENT_TYPE = "lw.identity.migration_route_selected" as const;
export const MIGRATION_FINALIZATION_STARTED_EVENT_TYPE =
  "lw.identity.migration_finalization_started" as const;
export const MIGRATION_FINALIZED_EVENT_TYPE = "lw.identity.migration_finalized" as const;

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
  CONNECTION_RENAMED_EVENT_TYPE,
  REPLACEMENT_CONNECTION_REGISTERED_EVENT_TYPE,
  MIGRATION_ROUTE_SELECTED_EVENT_TYPE,
  MIGRATION_FINALIZATION_STARTED_EVENT_TYPE,
  MIGRATION_FINALIZED_EVENT_TYPE,
] as const;
export type SsoConnectionEventType = (typeof SSO_CONNECTION_EVENT_TYPES)[number];

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
  /** Defaults to the operator, so every fact written before the published
   *  record could decide a claim decodes as exactly what it was. */
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

/**
 * A domain taken back out, by whoever manages the connection. It carries
 * only the domain and the actor: everything that domain had is derived
 * state the fold recomputes without it, and the history keeps every step.
 */
export const domainWithdrawnPayloadSchema = z.object({
  connectionId: z.string().min(1),
  domain: z.string().min(1),
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
   * When the published record stops proving anything; null for a ceremony
   * that does not expire. A deadline rather than a sweep: nothing deletes an
   * expired ceremony, the guard refuses to read it as a proof.
   */
  expiresAtMs: z.number().int().nonnegative().nullable().default(null),
  actor: identityActorSchema,
  ...sourced,
});

/**
 * Domain attestation (D05 amendment): out of band, no token. Goes APPROVED→VERIFIED in one step.
 */
export const domainAttestedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  domain: z.string().min(1),
  /** A ticket, case or other durable reference to the evidence reviewed. */
  evidenceRef: ssoAttestationEvidenceRefSchema.nullable().optional(),
  /** What the operator checked. Kept bounded because this is event data. */
  note: ssoAttestationNoteSchema.nullable().optional(),
  /** The platform operator who attested. Recorded because an attested domain
   *  is exactly as trustworthy as the operator behind it, and a dispute is
   *  answered from this fact. */
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
 * first goes missing. `graceEndsAtMs` rides on the fact: the deadline a
 * customer was TOLD is the one they get, whatever the window becomes.
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
 * The grace ran out with the record still missing (ADR-123). The domain stops
 * vouching for NEW people; it suspends nothing and un-proves nothing, because
 * routing is untouched.
 */
export const domainProofLapsedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  domain: z.string().min(1),
  /** Carried forward so the fact says how long it was gone before we acted. */
  firstAbsentAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
  ...sourced,
});

/**
 * The record is published again (ADR-123). Recovery costs the customer
 * nothing but publishing it: the domain was never un-proved, only doubted.
 */
export const domainProofRecoveredPayloadSchema = z.object({
  connectionId: z.string().min(1),
  domain: z.string().min(1),
  /** How long the evidence was missing, end to end. */
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
  /** The break-glass recovery reservation this activation holds, so a retry
   *  by the same actor reuses it and nobody else can adopt it. */
  activationReservationCommandId: z.string().min(1).optional(),
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
  activationReservationCommandId: z.string().min(1).optional(),
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

/**
 * A connection fact as a command decides it. The framework envelope
 * (aggregate, tenant, ids, idempotency key) and `occurredAt` are stamped by
 * whoever appends.
 */
export const connectionArrivalPolicySetPayloadSchema = z.object({
  connectionId: z.string().min(1),
  policy: ssoArrivalPolicySchema,
  actor: identityActorSchema,
  ...sourced,
});

/** What proved one domain, as a fact carries it — the replacement inherits
 *  these whole rather than re-running a ceremony the customer already ran. */
export const ssoDomainVerificationSchema = z.object({
  domain: z.string().min(1),
  method: ssoVerificationMethodSchema,
  /** Who proved it; null for a system actor, which is what the grandfather migration is. */
  actorId: z.string().nullable(),
  verifiedAtMs: z.number().int().nonnegative(),
  /** Whether that evidence is still there (ADR-123) — never about the method or the prover. */
  proofState: ssoDomainProofStateSchema,
  /** When a re-check first found the record gone, and when that becomes a lapse. */
  firstAbsentAtMs: z.number().int().nonnegative().nullable(),
  graceEndsAtMs: z.number().int().nonnegative().nullable(),
  /** `sha256:…` of the published token, so a re-read is verification; null for a proof
   *  that published nothing (attestation, licence, grandfather), which is never re-read. */
  tokenHash: z.string().nullable(),
  evidenceRef: z.string().min(1).max(500).nullable().optional(),
  note: z.string().min(1).max(1_000).nullable().optional(),
});

export const connectionRenamedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  /** Trimmed and non-empty: a connection with a blank name is one whose card
   *  has nothing on it, and the cards are the only place it is read. */
  name: z.string().trim().min(1),
  actor: identityActorSchema,
  ...sourced,
});

export const replacementConnectionRegisteredPayloadSchema = z.object({
  ...connectionRegisteredPayloadSchema.shape,
  replacesConnectionId: z.string().min(1),
  inheritedDomainVerifications: z.array(ssoDomainVerificationSchema).default([]),
});

export const migrationRouteSelectedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  route: ssoMigrationRouteSchema,
  actor: identityActorSchema,
  ...sourced,
});

export const migrationFinalizationStartedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  actor: identityActorSchema,
  ...sourced,
});

export const migrationFinalizedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  actor: identityActorSchema,
  ...sourced,
});

export const ssoConnectionFactInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE),
    data: connectionArrivalPolicySetPayloadSchema,
  }),
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
    type: z.literal(CONNECTION_RENAMED_EVENT_TYPE),
    data: connectionRenamedPayloadSchema,
  }),
  z.object({
    type: z.literal(REPLACEMENT_CONNECTION_REGISTERED_EVENT_TYPE),
    data: replacementConnectionRegisteredPayloadSchema,
  }),
  z.object({
    type: z.literal(MIGRATION_ROUTE_SELECTED_EVENT_TYPE),
    data: migrationRouteSelectedPayloadSchema,
  }),
  z.object({
    type: z.literal(MIGRATION_FINALIZATION_STARTED_EVENT_TYPE),
    data: migrationFinalizationStartedPayloadSchema,
  }),
  z.object({
    type: z.literal(MIGRATION_FINALIZED_EVENT_TYPE),
    data: migrationFinalizedPayloadSchema,
  }),
]);
export type SsoConnectionFactInput = z.infer<typeof ssoConnectionFactInputSchema>;

/** A fact with its business time — what the reducer folds. */
export type SsoConnectionFact = SsoConnectionFactInput & { occurredAt: number };

// ---- folded state --------------------------------------------------------

/**
 * What proved one domain, kept per domain and forever (D05 amendment). The
 * method rides on the connection itself, not only the log, so an attested
 * domain can never be presented as one the customer proved.
 */
export type SsoDomainVerification = z.infer<typeof ssoDomainVerificationSchema>;

/**
 * One claim on one domain. `waitedMs` is RECORDED rather than derived, because
 * a re-claim after a rejection overwrites the row's clock and a queue-latency
 * measurement a later action can rewrite is not one.
 */
export const ssoDomainClaimSchema = z.object({
  domain: z.string(),
  state: ssoDomainClaimStateSchema,
  claimedAtMs: z.number(),
  claimedByActorId: z.string().nullable(),
  /** When it was decided; null while it is still waiting. */
  decidedAtMs: z.number().nullable(),
  decidedByActorId: z.string().nullable(),
  /** What authorized the decision; null while it is still waiting. */
  authority: ssoDomainClaimAuthoritySchema.nullable(),
  waitedMs: z.number().nullable(),
  /** The reviewer's words, on a rejection. Read back on a re-claim. */
  note: z.string().nullable(),
});
export type SsoDomainClaim = z.infer<typeof ssoDomainClaimSchema>;

/**
 * One connection as the projection knows it — one row of `SsoConnection`,
 * and the state every guard is evaluated against.
 */
export interface SsoConnectionState {
  connectionId: string;
  organizationId: string;
  type: SsoConnectionType;
  state: SsoConnectionLifecycleState;
  /** Claimed but not yet approved. */
  claimedDomains: string[];
  /** Every claim this connection has made, in order: where each stands,
   *  when it was made and how long it waited. */
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
  /** When somebody CHOSE it, or null while the registration default stands.
   *  A different fact from the policy: going live waits for the deciding,
   *  and "turn everybody away" is a decision too. */
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
  /** The grandfathered connection this direct one replaces. Null for an
   *  ordinary connection, and for the grandfathered predecessor itself. */
  replacesConnectionId: string | null;
  /** Where the cutover stands. Null outside a migration pair. */
  migrationPhase: SsoMigrationPhase | null;
  graceStartedAtMs: number | null;
  /** When an administrator last chose the route. Audit evidence only: the
   *  route is derived from the phase, never from recency. */
  routeChangedAtMs: number | null;
  finalizationRequestedAtMs: number | null;
  finalizedAtMs: number | null;
}

const EMPTY_IDP: SsoIdpMetadata = {
  issuer: null,
  providerId: "",
  clientIdRef: null,
  secretRef: null,
  certRefs: [],
};

/**
 * Whether a pending ceremony's record has stopped proving anything. A
 * ceremony with no deadline never expires, which is what the attested and
 * licence-bound ones are.
 */
export function verificationHasExpired({
  pending,
  nowMs,
}: {
  pending: { expiresAtMs: number | null };
  nowMs: number;
}): boolean {
  return pending.expiresAtMs !== null && nowMs > pending.expiresAtMs;
}

export function emptySsoConnection({ connectionId }: { connectionId: string }): SsoConnectionState {
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
    replacesConnectionId: null,
    migrationPhase: null,
    graceStartedAtMs: null,
    routeChangedAtMs: null,
    finalizationRequestedAtMs: null,
    finalizedAtMs: null,
  };
}

const without = (domains: string[], domain: string): string[] =>
  domains.filter((held) => held !== domain);

/** Past these, a domain fact never moves the lifecycle. */
const LIFECYCLE_BEYOND_VERIFIED: readonly SsoConnectionLifecycleState[] = [
  "ACTIVE",
  "SUSPENDED",
  "TEARDOWN_PENDING",
  "TORN_DOWN",
  "DISCARDED",
];

/**
 * Every trace of one domain out of the derived state, leaving the connection
 * on whatever its remaining domains earned. The history keeps every step the
 * domain took; only the state stops saying it is here.
 */
const withoutDomain = (state: SsoConnectionState, domain: string): SsoConnectionState => {
  const remaining = {
    ...state,
    claimedDomains: without(state.claimedDomains, domain),
    approvedDomains: without(state.approvedDomains, domain),
    verifiedDomains: without(state.verifiedDomains, domain),
    domainVerifications: state.domainVerifications.filter(
      (verification) => verification.domain !== domain,
    ),
    pendingVerification:
      state.pendingVerification?.domain === domain ? null : state.pendingVerification,
    // A tombstone, not a deletion: a row the customer could remove is a claim
    // budget the customer could reset.
    domainClaims: state.domainClaims.map((claim) =>
      claim.domain === domain ? { ...claim, state: "WITHDRAWN" as const } : claim,
    ),
    rejection: state.rejection?.domain === domain ? null : state.rejection,
  };

  return { ...remaining, state: stateAfterWithdrawal(remaining) };
};

/** Where a connection stands once a domain has left it: whatever the
 *  REMAINING domains have earned, and nothing the departed one did. */
const stateAfterWithdrawal = (state: SsoConnectionState): SsoConnectionLifecycleState => {
  if (LIFECYCLE_BEYOND_VERIFIED.includes(state.state)) return state.state;
  if (state.verifiedDomains.length > 0) return "VERIFIED";
  if (state.pendingVerification !== null) return "VERIFICATION_PENDING";
  if (state.approvedDomains.length > 0) return "APPROVED";
  if (state.domainClaims.some((claim) => claim.state === "WAITING")) return "CLAIMED";
  if (state.domainClaims.some((claim) => claim.state === "REJECTED")) return "REJECTED";

  return "DRAFT";
};

/**
 * Where a fact about ONE domain leaves the lifecycle: never below what the
 * remaining domains already earned. Without it a connection that proved one
 * domain and claimed a second dropped to CLAIMED and could not go live.
 */
const lifecycleAfterDomainFact = (
  state: SsoConnectionState,
  proposed: SsoConnectionLifecycleState,
): SsoConnectionLifecycleState => {
  if (LIFECYCLE_BEYOND_VERIFIED.includes(state.state)) return state.state;
  if (state.verifiedDomains.length > 0) return "VERIFIED";
  return proposed;
};

/** One claim row per domain, last claim wins; the earlier attempt stays in the event log. */
const withClaim = (held: SsoDomainClaim[], claim: SsoDomainClaim): SsoDomainClaim[] => [
  ...held.filter((entry) => entry.domain !== claim.domain),
  claim,
];

/** Decides the claim on a domain, leaving every other row alone. */
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

const withDomain = (domains: string[], domain: string): string[] =>
  domains.includes(domain) ? domains : [...domains, domain];

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
 * alone (ADR-123). A statement about a domain with no proof changes nothing;
 * the guards refuse that before any fact exists.
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

/** The facts about the legacy-to-direct pair, and the name on the card. */
type SsoMigrationFact = Extract<
  SsoConnectionFact,
  {
    type:
      | typeof CONNECTION_RENAMED_EVENT_TYPE
      | typeof REPLACEMENT_CONNECTION_REGISTERED_EVENT_TYPE
      | typeof MIGRATION_ROUTE_SELECTED_EVENT_TYPE
      | typeof MIGRATION_FINALIZATION_STARTED_EVENT_TYPE
      | typeof MIGRATION_FINALIZED_EVENT_TYPE;
  }
>;

/** The five the cutover states, out of the twenty-two a connection has. */
const SSO_MIGRATION_FACT_TYPES: readonly SsoConnectionFact["type"][] = [
  CONNECTION_RENAMED_EVENT_TYPE,
  REPLACEMENT_CONNECTION_REGISTERED_EVENT_TYPE,
  MIGRATION_ROUTE_SELECTED_EVENT_TYPE,
  MIGRATION_FINALIZATION_STARTED_EVENT_TYPE,
  MIGRATION_FINALIZED_EVENT_TYPE,
];

function isSsoMigrationFact(fact: SsoConnectionFact): fact is SsoMigrationFact {
  return SSO_MIGRATION_FACT_TYPES.includes(fact.type);
}

/** The cutover's own arms, folded apart from the lifecycle's. */
function reduceSsoMigrationFact({
  state,
  touched,
  fact,
}: {
  state: SsoConnectionState;
  touched: SsoConnectionState;
  fact: SsoMigrationFact;
}): SsoConnectionState {
  switch (fact.type) {
    case CONNECTION_RENAMED_EVENT_TYPE:
      // Folded onto the metadata the name already lived in, rather than into
      // a field beside it: one string, one reader, nothing to keep in step.
      return { ...touched, idpMetadata: { ...touched.idpMetadata, providerId: fact.data.name } };
    case REPLACEMENT_CONNECTION_REGISTERED_EVENT_TYPE:
      return {
        ...touched,
        connectionId: fact.data.connectionId,
        organizationId: fact.data.organizationId,
        type: fact.data.type,
        // The proofs come with it, so a replacement starts where the
        // predecessor stood rather than re-proving a proved domain.
        state: fact.data.inheritedDomainVerifications.length > 0 ? "VERIFIED" : "DRAFT",
        idpMetadata: fact.data.idp,
        arrivalPolicy: fact.data.arrivalPolicy,
        source: fact.data.source,
        createdBy: fact.data.actor.id,
        createdAtMs: fact.occurredAt,
        replacesConnectionId: fact.data.replacesConnectionId,
        migrationPhase: "SETUP",
        verifiedDomains: fact.data.inheritedDomainVerifications.map((proof) => proof.domain),
        domainVerifications: fact.data.inheritedDomainVerifications,
      };
    case MIGRATION_ROUTE_SELECTED_EVENT_TYPE:
      return {
        ...touched,
        migrationPhase: fact.data.route === "legacy" ? "GRACE_LEGACY" : "GRACE_DIRECT",
        graceStartedAtMs: state.graceStartedAtMs ?? fact.occurredAt,
        routeChangedAtMs: fact.occurredAt,
      };
    case MIGRATION_FINALIZATION_STARTED_EVENT_TYPE:
      return {
        ...touched,
        migrationPhase: "FINALIZING",
        finalizationRequestedAtMs: fact.occurredAt,
      };
    case MIGRATION_FINALIZED_EVENT_TYPE:
      return { ...touched, migrationPhase: "FINALIZED", finalizedAtMs: fact.occurredAt };
  }
}

/**
 * The reducer. Pure and total: the same function runs in the framework's
 * fold, the replay proof, and a browser tab. Guards refuse a forbidden fact
 * before it exists, so this file states transitions, never re-checks them.
 */
export function reduceSsoConnection({
  state,
  fact,
}: {
  state: SsoConnectionState;
  fact: SsoConnectionFact;
}): SsoConnectionState {
  const touched = { ...state, updatedAtMs: fact.occurredAt };

  return isSsoMigrationFact(fact)
    ? reduceSsoMigrationFact({ state, touched, fact })
    : reduceSsoLifecycleFact({ state, touched, fact });
}

/** Everything the lifecycle states: registration, domains, going live, and
 *  the way out. */
function reduceSsoLifecycleFact({
  state,
  touched,
  fact,
}: {
  state: SsoConnectionState;
  touched: SsoConnectionState;
  fact: Exclude<SsoConnectionFact, SsoMigrationFact>;
}): SsoConnectionState {
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
    // Deciding is its own fact: a connection always has a behaviour, and
    // separately somebody has or has not chosen it.
    case CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE:
      return {
        ...touched,
        arrivalPolicy: fact.data.policy,
        arrivalPolicyDecidedAtMs: fact.occurredAt,
      };
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
          evidenceRef: fact.data.evidenceRef ?? null,
          note: fact.data.note ?? null,
        }),
        pendingVerification: null,
      };
    case DOMAIN_WITHDRAWN_EVENT_TYPE:
      return withoutDomain(touched, fact.data.domain);
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
          proofState: "VERIFIED",
          firstAbsentAtMs: null,
          graceEndsAtMs: null,
          // Carried from the ceremony this fact closes, the one moment the
          // hash is in hand. Derived from folded state rather than the
          // payload, so a replay reconstructs it identically.
          tokenHash:
            state.pendingVerification?.domain === fact.data.domain &&
            isSsoPublishedProofChannel(state.pendingVerification.method)
              ? state.pendingVerification.tokenHash
              : null,
        }),
        pendingVerification: null,
      };
    // A doubted, lapsed or recovered proof moves no lifecycle and un-proves
    // nothing: `verifiedDomains` is untouched, because routing is untouched.
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
          // The clock has run; keeping a deadline would say one still is.
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
  }
}

/** Which connection decides an ordinary sign-in, read from the persisted
 *  phase and never from a timestamp. */
export function ssoMigrationRouteOf(phase: SsoMigrationPhase): SsoMigrationRoute {
  switch (phase) {
    case "SETUP":
    case "GRACE_LEGACY":
      return "legacy";
    case "GRACE_DIRECT":
    case "FINALIZING":
    case "FINALIZED":
      return "direct";
  }
}

// ---- routing projection --------------------------------------------------

/**
 * The lifecycle as ROUTING sees it (`SsoConnectionRoutingState`). Only an
 * ACTIVE connection serves traffic; SUSPENDED is the paused state the
 * guidance screens name; everything else is simply not a door.
 */
export function routingStateOf(state: SsoConnectionLifecycleState): RoutableConnection["state"] {
  if (state === "ACTIVE") return "ACTIVE";
  if (state === "SUSPENDED") return "SUSPENDED";
  return "INACTIVE";
}

/**
 * Routing comparison: method, state, deployment, provisioning.
 * Ignores connection ID (legacy and projection formats differ).
 */
export interface ConnectionRoutingFacts {
  routes: boolean;
  methodId: string | null;
  state: RoutableConnection["state"] | null;
  configured: boolean | null;
  allowsJit: boolean | null;
}

export function routingFactsOf(connection: RoutableConnection | null): ConnectionRoutingFacts {
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
 * The one comparison shadow mode runs on every login and the grandfather
 * migration runs per domain to earn `finalized`. Pure, so computing it can
 * never be what changes a sign-in.
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
