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
export type SsoConnectionLifecycleState = z.infer<typeof ssoConnectionStateSchema>;

/**
 * How a domain claim is proved. Self-hosted installations that cannot
 * publish a TXT record prove ownership with their license token instead.
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
 * be theater. The ceremony commands accept the first two only.
 */
export const SSO_VERIFICATION_METHODS = [
  "dns-txt",
  "license-token",
  "operator-attested",
  "legacy-configuration",
] as const;
export const ssoVerificationMethodSchema = z.enum(SSO_VERIFICATION_METHODS);
export type SsoVerificationMethod = z.infer<typeof ssoVerificationMethodSchema>;

export const SSO_VERIFICATION_CEREMONY_METHODS = ["dns-txt", "license-token"] as const;
export const ssoVerificationCeremonyMethodSchema = z.enum(SSO_VERIFICATION_CEREMONY_METHODS);
export type SsoVerificationCeremonyMethod = z.infer<typeof ssoVerificationCeremonyMethodSchema>;

/**
 * Where a connection came from. `legacy-grandfathered` is stamped on every
 * event the grandfather migration emits, so an operator reading a
 * connection's history can always tell which ones a human configured and
 * which the migration inferred from two string columns.
 */
export const SSO_CONNECTION_SOURCES = ["self-serve", "legacy-grandfathered"] as const;
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

export const CONNECTION_REGISTERED_EVENT_TYPE = "lw.identity.connection_registered" as const;
export const DOMAIN_CLAIMED_EVENT_TYPE = "lw.identity.domain_claimed" as const;
export const DOMAIN_CLAIM_APPROVED_EVENT_TYPE = "lw.identity.domain_claim_approved" as const;
export const DOMAIN_CLAIM_REJECTED_EVENT_TYPE = "lw.identity.domain_claim_rejected" as const;
export const CONNECTION_DISCARDED_EVENT_TYPE = "lw.identity.connection_discarded" as const;
export const VERIFICATION_REQUESTED_EVENT_TYPE = "lw.identity.verification_requested" as const;
export const DOMAIN_ATTESTED_EVENT_TYPE = "lw.identity.domain_attested" as const;
export const DOMAIN_VERIFIED_EVENT_TYPE = "lw.identity.domain_verified" as const;
export const CONNECTION_ACTIVATED_EVENT_TYPE = "lw.identity.connection_activated" as const;
export const CONNECTION_SUSPENDED_EVENT_TYPE = "lw.identity.connection_suspended" as const;
export const CONNECTION_RESUMED_EVENT_TYPE = "lw.identity.connection_resumed" as const;
export const TEARDOWN_REQUESTED_EVENT_TYPE = "lw.identity.teardown_requested" as const;
export const CONNECTION_TORN_DOWN_EVENT_TYPE = "lw.identity.connection_torn_down" as const;

export const SSO_CONNECTION_EVENT_TYPES = [
  CONNECTION_REGISTERED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
  CONNECTION_DISCARDED_EVENT_TYPE,
  VERIFICATION_REQUESTED_EVENT_TYPE,
  DOMAIN_ATTESTED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_SUSPENDED_EVENT_TYPE,
  CONNECTION_RESUMED_EVENT_TYPE,
  TEARDOWN_REQUESTED_EVENT_TYPE,
  CONNECTION_TORN_DOWN_EVENT_TYPE,
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
  /** Whether an unmatched callback subject may provision a user. */
  allowsJit: z.boolean(),
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

export const domainVerifiedPayloadSchema = z.object({
  connectionId: z.string().min(1),
  domain: z.string().min(1),
  method: ssoVerificationMethodSchema,
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
    type: z.literal(DOMAIN_VERIFIED_EVENT_TYPE),
    data: domainVerifiedPayloadSchema,
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
]);
export type SsoConnectionFactInput = z.infer<typeof ssoConnectionFactInputSchema>;

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
}

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
  } | null;
  idpMetadata: SsoIdpMetadata;
  allowsJit: boolean;
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

export function emptySsoConnection({ connectionId }: { connectionId: string }): SsoConnectionState {
  return {
    connectionId,
    organizationId: "",
    type: "oidc",
    state: "DRAFT",
    claimedDomains: [],
    approvedDomains: [],
    verifiedDomains: [],
    domainVerifications: [],
    pendingVerification: null,
    idpMetadata: EMPTY_IDP,
    allowsJit: false,
    source: "self-serve",
    testLoginAccountId: null,
    rejection: null,
    createdBy: null,
    createdAtMs: 0,
    updatedAtMs: 0,
    tearDownAfterMs: null,
  };
}

const without = (domains: string[], domain: string): string[] =>
  domains.filter((held) => held !== domain);

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
        allowsJit: fact.data.allowsJit,
        source: fact.data.source,
        createdBy: fact.data.actor.id,
        createdAtMs: fact.occurredAt,
      };
    case DOMAIN_CLAIMED_EVENT_TYPE:
      return {
        ...touched,
        state: "CLAIMED",
        claimedDomains: withDomain(state.claimedDomains, fact.data.domain),
        rejection: null,
      };
    case DOMAIN_CLAIM_APPROVED_EVENT_TYPE:
      return {
        ...touched,
        state: "APPROVED",
        claimedDomains: without(state.claimedDomains, fact.data.domain),
        approvedDomains: withDomain(state.approvedDomains, fact.data.domain),
      };
    case DOMAIN_CLAIM_REJECTED_EVENT_TYPE:
      return {
        ...touched,
        state: "REJECTED",
        claimedDomains: without(state.claimedDomains, fact.data.domain),
        rejection: { domain: fact.data.domain, note: fact.data.note },
      };
    case CONNECTION_DISCARDED_EVENT_TYPE:
      return { ...touched, state: "DISCARDED" };
    case VERIFICATION_REQUESTED_EVENT_TYPE:
      return {
        ...touched,
        state: "VERIFICATION_PENDING",
        pendingVerification: {
          domain: fact.data.domain,
          method: fact.data.method,
          tokenHash: fact.data.tokenHash,
        },
      };
    // Attestation is one step, not two: there is nothing to wait for between
    // the operator deciding and the domain being proved, so it folds exactly
    // as a verification does — and records its own method, permanently.
    case DOMAIN_ATTESTED_EVENT_TYPE:
      return {
        ...touched,
        state: "VERIFIED",
        approvedDomains: without(state.approvedDomains, fact.data.domain),
        verifiedDomains: withDomain(state.verifiedDomains, fact.data.domain),
        domainVerifications: withVerification(state.domainVerifications, {
          domain: fact.data.domain,
          method: "operator-attested",
          actorId: fact.data.actor.id,
          verifiedAtMs: fact.occurredAt,
        }),
        pendingVerification: null,
      };
    case DOMAIN_VERIFIED_EVENT_TYPE:
      return {
        ...touched,
        state: "VERIFIED",
        approvedDomains: without(state.approvedDomains, fact.data.domain),
        verifiedDomains: withDomain(state.verifiedDomains, fact.data.domain),
        domainVerifications: withVerification(state.domainVerifications, {
          domain: fact.data.domain,
          method: fact.data.method,
          actorId: fact.data.actor.id,
          verifiedAtMs: fact.occurredAt,
        }),
        pendingVerification: null,
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
 * The one comparison `SSOCONN_ROUTING` shadow mode runs on every live login
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
