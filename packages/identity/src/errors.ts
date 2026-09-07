import { HandledError } from "@langwatch/handled-error";

/**
 * Every identity refusal in one place. Handled (ADR-045): the cause is
 * known and the caller can act on it, so each refusal is a literal-code
 * subclass, and the app's client presentation registry carries the copy for
 * each code. Assert on `code`, never the message; the detail string is
 * logged, never shown.
 */

/**
 * A guard's refusal — thrown before any fact exists, surfaced by the
 * dispatching ceremony (better-auth's own protocol flow through the
 * adapter, or the backfill, which treats it as a parity fact).
 */
export abstract class IdentityCommandRefusedError extends HandledError {}

export class IdentityIdentifierNotFoundError extends IdentityCommandRefusedError {
  constructor(detail: string) {
    super("identity_identifier_not_found", "identity_identifier_not_found", {
      httpStatus: 404,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityIdentifierNotFoundError";
  }
}

export class IdentityIdentifierNotVerifiableError extends IdentityCommandRefusedError {
  constructor(detail: string) {
    super(
      "identity_identifier_not_verifiable",
      "identity_identifier_not_verifiable",
      { httpStatus: 409, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "IdentityIdentifierNotVerifiableError";
  }
}

export class IdentityPrimaryMustDemoteFirstError extends IdentityCommandRefusedError {
  constructor(detail: string) {
    super(
      "identity_primary_must_demote_first",
      "identity_primary_must_demote_first",
      { httpStatus: 409, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "IdentityPrimaryMustDemoteFirstError";
  }
}

/**
 * The cross-population uniqueness refusal (ADR-116 §6): the normalized
 * address is already somebody else's.
 *
 * Refused at VERIFY and at PRIMARY, never at attach — an unverified
 * (`ATTACHED`) identifier blocks nobody, so there is no squatting, and
 * verify is the choke point in both directions. "Somebody else" spans both
 * populations, which is the point: a latched user's verified identifier and
 * a legacy user's `User.email` are the same claim on the same mailbox, and
 * only one of them can hold it. Without this, a PRIMARY switch onto a taken
 * address reaches the fold and dies on `User.email @unique` — a write
 * failure with no name, in a projection, long after the user could have
 * been told.
 */
export class IdentityEmailInUseError extends IdentityCommandRefusedError {
  constructor(detail: string) {
    super("identity_email_in_use", "identity_email_in_use", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
      tips: [
        "Sign in with the account that already holds this address, or use a different one.",
      ],
    });
    this.name = "IdentityEmailInUseError";
  }
}

export class IdentityPrimaryRequiresVerifiedError extends IdentityCommandRefusedError {
  constructor(detail: string) {
    super(
      "identity_primary_requires_verified",
      "identity_primary_requires_verified",
      { httpStatus: 409, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "IdentityPrimaryRequiresVerifiedError";
  }
}

/**
 * A verification ceremony refusal. Two customer-visible codes only, on
 * purpose: every pin/proof/consumption failure answers
 * `identity_verification_invalid` so the completion endpoint is not an
 * oracle for which check failed — the precise reason goes to the log line,
 * keyed by verificationId. Expiry is separable because its remediation
 * differs (request a new link).
 */
export class IdentityVerificationInvalidError extends HandledError {
  constructor() {
    super("identity_verification_invalid", "identity_verification_invalid", {
      httpStatus: 400,
      fault: "customer",
      tips: [
        "Open the newest verification email and complete it from the place where you requested it.",
      ],
    });
    this.name = "IdentityVerificationInvalidError";
  }
}

export class IdentityVerificationExpiredError extends HandledError {
  constructor() {
    super("identity_verification_expired", "identity_verification_expired", {
      httpStatus: 410,
      fault: "customer",
      tips: ["Request a new verification email and use the newest link."],
    });
    this.name = "IdentityVerificationExpiredError";
  }
}

/**
 * An SSO connection guard's refusal (ADR-117 §5, D04). Handled for the same
 * reason the identifier refusals are: each names a cause an operator can act
 * on, and the words they read live in the app's presentation registry keyed
 * by code. The detail string is logged, never shown.
 */
export abstract class SsoConnectionCommandRefusedError extends HandledError {}

export class SsoConnectionInvalidTransitionError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super(
      "sso_connection_invalid_transition",
      "sso_connection_invalid_transition",
      { httpStatus: 409, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "SsoConnectionInvalidTransitionError";
  }
}

/**
 * First verifier owns, and the loser is told plainly. The refusal names the
 * domain and nothing about who holds it: which organization configured SSO
 * for a domain is not a fact a second claimant is entitled to.
 */
export class SsoConnectionDomainTakenError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_connection_domain_taken", "sso_connection_domain_taken", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoConnectionDomainTakenError";
  }
}

/**
 * A domain nobody may claim on any tier: a consumer mail provider, a
 * registry suffix, or a bare top-level domain.
 *
 * Refused at the CLAIM rather than at the proof, because a published record
 * on such a domain would be genuine evidence of exactly the wrong thing —
 * that somebody controls a registry, or a mailbox at a provider whose
 * customers are everybody. The check moved from a reviewer's eye to the
 * guard when the published record became the decision, so it has to hold for
 * every caller rather than for whoever a person happened to read.
 *
 * The copy says to claim the company's own domain and lists nothing:
 * printing the deny-list turns a refusal into a way to enumerate it.
 */
export class SsoDomainNotEligibleError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_domain_not_eligible", "sso_domain_not_eligible", {
      httpStatus: 422,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoDomainNotEligibleError";
  }
}

/**
 * More domains claimed in the window than the connection is allowed.
 *
 * The rail that replaces a reviewer noticing volume. `retryAfterSeconds`
 * rides in `meta` rather than only in the words, so the screen counts down
 * from the guard's own answer instead of guessing — the same shape the join
 * throttle uses, for the same reason.
 */
export class SsoDomainClaimThrottledError extends SsoConnectionCommandRefusedError {
  constructor(retryAfterSeconds: number) {
    super("sso_domain_claim_throttled", "sso_domain_claim_throttled", {
      httpStatus: 429,
      fault: "customer",
      meta: { retryAfterSeconds },
    });
    this.name = "SsoDomainClaimThrottledError";
  }
}

/** Activation's preconditions are unmet: no verified domain, no live
 *  break-glass binding, or no recorded test login. */
export class SsoConnectionActivationBlockedError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super(
      "sso_connection_activation_blocked",
      "sso_connection_activation_blocked",
      { httpStatus: 409, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "SsoConnectionActivationBlockedError";
  }
}

/**
 * Activation's preconditions, refused ONE AT A TIME (wave 3).
 *
 * `sso_connection_activation_blocked` above stays exactly as it is: it is the
 * guard's, it is what every caller of the aggregate gets, and it is the right
 * answer for an operator who commanded an activation directly. What it is not
 * is an instruction — "this needs a verified domain, a test sign-in and a way
 * back in" tells a customer looking at their own setup screen nothing about
 * which of the three they are missing.
 *
 * So the self-serve surface checks the same three first and refuses by name,
 * and the guard refuses again underneath. Two refusals for one rule is
 * deliberate here in a way it usually is not: the surface's exists to be
 * ACTED on, the guard's exists to be true for every caller, and deleting
 * either would cost one of those.
 */
export abstract class SsoActivationPreconditionError extends SsoConnectionCommandRefusedError {}

/** No domain of this organization's has been proved, so nothing routes. */
export class SsoActivationDomainUnprovedError extends SsoActivationPreconditionError {
  constructor(detail: string) {
    super("sso_activation_domain_unproved", "sso_activation_domain_unproved", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoActivationDomainUnprovedError";
  }
}

/**
 * Nobody has signed in through the connection yet.
 *
 * The evidence is an account the engine wrote when the identity provider
 * handed a person back, so this refusal cannot be cleared by clicking
 * anything — it is cleared by signing in, which is the point.
 */
export class SsoActivationTestSignInMissingError extends SsoActivationPreconditionError {
  constructor(detail: string) {
    super(
      "sso_activation_test_sign_in_missing",
      "sso_activation_test_sign_in_missing",
      { httpStatus: 409, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "SsoActivationTestSignInMissingError";
  }
}

/**
 * Nobody can get in without the identity provider.
 *
 * The one refusal here that is about US rather than about the connection: it
 * is what stops an organization turning single sign-on on and discovering,
 * from outside, that a misconfigured provider is now the only door.
 */
export class SsoActivationBreakGlassMissingError extends SsoActivationPreconditionError {
  constructor(detail: string) {
    super(
      "sso_activation_break_glass_missing",
      "sso_activation_break_glass_missing",
      { httpStatus: 409, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "SsoActivationBreakGlassMissingError";
  }
}

/**
 * Nobody has said what this connection does with somebody it has never seen.
 *
 * A precondition rather than a default, because the default that shipped —
 * turn them away, and hand them a workspace of their own — is the one nobody
 * would pick, and it got picked by never being asked.
 */
export class SsoActivationArrivalsUndecidedError extends SsoActivationPreconditionError {
  constructor(detail: string) {
    super(
      "sso_activation_arrivals_undecided",
      "sso_activation_arrivals_undecided",
      { httpStatus: 409, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "SsoActivationArrivalsUndecidedError";
  }
}

/**
 * The person named could not use the way in they are being given.
 *
 * Break-glass exists so somebody can still get in when the identity provider
 * fails, and activation refuses without a live binding on the strength of
 * that. A binding naming somebody who is not an administrator of this
 * organization satisfies the check and opens no door — the precondition
 * passes and the thing it promised does not exist.
 */
export class SsoBreakGlassHolderIneligibleError extends SsoConnectionCommandRefusedError {
  constructor(userId: string) {
    super(
      "sso_break_glass_holder_ineligible",
      "sso_break_glass_holder_ineligible",
      {
        httpStatus: 422,
        fault: "customer",
        meta: { userId },
      },
    );
    this.name = "SsoBreakGlassHolderIneligibleError";
  }
}

/**
 * The connection named does not exist, or is not this organization's.
 *
 * ONE SENTENCE FOR BOTH, deliberately: telling somebody a connection exists
 * but is not theirs is a probe for other customers' connection ids. What
 * changes is only that it is now its OWN sentence — every one of these used
 * to be answered with `sso_domain_proof_not_found`, whose customer copy reads
 * "We couldn't find that record yet — publish the record shown here on your
 * domain, then check again." Two administrators with the page open, one of
 * whom discards the connection, sent the other to argue with their DNS team
 * about a record that was already published and a connection that was gone.
 */
export class SsoConnectionNotFoundError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_connection_not_found", "sso_connection_not_found", {
      httpStatus: 404,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoConnectionNotFoundError";
  }
}

/**
 * The expiry asked for is not one a grant may carry: in the past, or further
 * out than the window allows.
 *
 * The expiry is the whole of what stops a break-glass grant from becoming a
 * permanent second door past an organization's own identity provider, and
 * nothing bounded it — a date in the year 9999 was accepted, never expired,
 * and never warned, because the sweep only looks fourteen days ahead.
 */
export class SsoBreakGlassExpiryOutOfRangeError extends SsoConnectionCommandRefusedError {
  constructor(maxWindowDays: number) {
    super(
      "sso_break_glass_expiry_out_of_range",
      "sso_break_glass_expiry_out_of_range",
      {
        httpStatus: 422,
        fault: "customer",
        meta: { maxWindowDays },
      },
    );
    this.name = "SsoBreakGlassExpiryOutOfRangeError";
  }
}

/**
 * Revoking this grant would leave a live connection with no way back in.
 * The one lever that exists for the identity provider failing must not be
 * removable while the identity provider is what decides sign-in — grant
 * somebody else the way in first, or remove the connection itself.
 */
export class SsoBreakGlassLastWayInError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_break_glass_last_way_in", "sso_break_glass_last_way_in", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoBreakGlassLastWayInError";
  }
}

/**
 * Teardown would leave people with no way in. The detail carries how many
 * users for the log; the copy tells the operator what to do about it, which
 * is give those people another verified method first.
 */
export class SsoConnectionTeardownStrandsUsersError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super(
      "sso_connection_teardown_strands_users",
      "sso_connection_teardown_strands_users",
      { httpStatus: 409, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "SsoConnectionTeardownStrandsUsersError";
  }
}

/**
 * Somebody other than a LangWatch platform operator tried to take an
 * operator's act — attesting a domain, or deciding a domain claim.
 *
 * Refused in the guard rather than only at the surface, so the rule holds for
 * every caller the aggregate will ever have: an organization administrator
 * cannot attest their own domain on any deployment, however they reach the
 * command. The copy points at the way their domain IS proved, which is
 * publishing the record — a refusal that only says "no" would leave a
 * customer administrator with nothing to do next.
 */
export class SsoConnectionOperatorActRequiredError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super(
      "sso_connection_operator_act_required",
      "sso_connection_operator_act_required",
      { httpStatus: 403, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "SsoConnectionOperatorActRequiredError";
  }
}

/**
 * A SAML connection registered through a self-serve surface. Refused by name
 * rather than accepted and left dark: D05 is OIDC only, the aggregate is
 * protocol-agnostic on purpose, and which engine terminates SAML is a
 * decision D09 makes against a named customer's connection. The words say to
 * talk to LangWatch and name no engine, library or release.
 */
/**
 * A second connection, registered through a surface that holds exactly one
 * (D09).
 *
 * The bound is what stops connection registration being the way around the
 * per-connection claim limit: five domains an hour is a rate limit only while
 * an organization has one connection to spend them from, and an unbounded
 * register would make it five an hour PER registration. One connection is
 * also what the self-serve journey has always meant — offering to register a
 * second before the first routes anything is offering a way to lock yourself
 * out twice.
 *
 * A torn-down or discarded connection is not one: it is a tombstone, and a
 * customer whose connection was removed is setting up from nothing again.
 */
export class SsoConnectionAlreadyRegisteredError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super(
      "sso_connection_already_registered",
      "sso_connection_already_registered",
      { httpStatus: 409, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "SsoConnectionAlreadyRegisteredError";
  }
}

/**
 * A registration that named a protocol but not the things needed to speak it
 * (D09): an OpenID Connect provider with no client id or no client secret, a
 * SAML provider with neither metadata nor an entity id and certificate.
 *
 * Refused before anything is written, and refused as ONE code rather than one
 * per missing field: the reader is filling a form in, and the form is what
 * says which box is empty. What the code has to carry is that the connection
 * was not registered.
 */
export class SsoCredentialsRequiredError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_credentials_required", "sso_credentials_required", {
      httpStatus: 422,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoCredentialsRequiredError";
  }
}

/**
 * The address given as the OpenID Connect issuer did not answer with a
 * discovery document (D09).
 *
 * `fault` is the customer's, and deliberately so even though the failure was
 * a network call OF OURS: what failed is the address they typed, and the
 * action that fixes it is theirs. The detail names what went wrong for the
 * log; the message says nothing about our side of the call.
 */
export class SsoIssuerUnreachableError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_issuer_unreachable", "sso_issuer_unreachable", {
      httpStatus: 422,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoIssuerUnreachableError";
  }
}

/** What was pasted as identity provider metadata is not a SAML descriptor
 *  (D09). Refused before anything is written. */
export class SsoSamlMetadataInvalidError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_saml_metadata_invalid", "sso_saml_metadata_invalid", {
      httpStatus: 422,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoSamlMetadataInvalidError";
  }
}

/** The signing certificate could not be read (D09). Separate from metadata
 *  because they are two fields on the form and two different things to go
 *  and fetch again. */
export class SsoCertificateInvalidError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_certificate_invalid", "sso_certificate_invalid", {
      httpStatus: 422,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoCertificateInvalidError";
  }
}

/**
 * A legacy `ssoDomain` / `ssoProvider` edit after the routing flip. Refused
 * rather than ignored: once the connection projection decides sign-in, a
 * string edit changes nothing a person would experience, and silently
 * accepting one leaves a staff member believing they fixed something.
 */
export class SsoConnectionStringEditRetiredError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super(
      "sso_connection_string_edit_retired",
      "sso_connection_string_edit_retired",
      { httpStatus: 409, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "SsoConnectionStringEditRetiredError";
  }
}

/**
 * Single sign-on setup on an installation that has never held a genuine
 * licence (D05 tier 2). The licence is what authorizes a self-hosted
 * customer's domain, so without one there is no path to offer at all.
 *
 * The words name activating a licence and nothing else: an environment
 * variable, a hostname or an internal service in a customer-facing message
 * would be both useless to the reader and an internals leak on a surface
 * that is not always read by an operator.
 */
export class SsoLicenseRequiredError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_license_required", "sso_license_required", {
      httpStatus: 403,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoLicenseRequiredError";
  }
}

/**
 * A domain whose claim is still waiting for LangWatch cannot be proved yet
 * (D05 tier 3). Refused before the customer publishes anything, because
 * refusing afterwards would mean telling them the record they just asked
 * their DNS team for is worthless.
 *
 * The copy says the claim is being looked at and nothing about who is
 * looking: queue staffing is ours, and a customer told a named person has
 * their claim is a customer who will chase that person.
 */
export class SsoDomainClaimPendingError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_domain_claim_pending", "sso_domain_claim_pending", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoDomainClaimPendingError";
  }
}

/** The record we asked for is not published on the domain yet (D05 tier 3).
 *  A refusal rather than a retry loop, so the customer is told plainly and
 *  the record they were given stays on screen, unchanged. */
export class SsoDomainProofNotFoundError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_domain_proof_not_found", "sso_domain_proof_not_found", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoDomainProofNotFoundError";
  }
}

/**
 * We could not READ the domain's records at all (D05 tier 3) — a resolver
 * that timed out, refused, or answered SERVFAIL.
 *
 * Distinct from `sso_domain_proof_not_found` on purpose, and the distinction
 * is the whole point of having this code: "we looked and it is not there" is
 * a customer's next step (publish it, wait for propagation), and "we could
 * not look" is not their next step at all. Collapsing the two sends an
 * administrator to argue with a DNS team about a record they already
 * published correctly.
 *
 * The fault is the provider's rather than the customer's, and it is stated
 * rather than left to default: a 5xx that logs as routine customer noise is
 * an incident nobody sees. The detail names what the resolver said; the copy
 * says to try again, because that is the only true instruction.
 */
export class SsoDomainLookupFailedError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_domain_lookup_failed", "sso_domain_lookup_failed", {
      httpStatus: 503,
      fault: "provider",
      reasons: [new Error(detail)],
    });
    this.name = "SsoDomainLookupFailedError";
  }
}

/** The verification file is not being served at the well-known path yet —
 *  the domain answered, and what it answered was not the token. Its own code
 *  rather than the record's, because the remedy is different words: put the
 *  file at the path, not publish a record and wait for DNS. */
export class SsoDomainFileNotFoundError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_domain_file_not_found", "sso_domain_file_not_found", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoDomainFileNotFoundError";
  }
}

/**
 * We could not FETCH the file at all — the domain did not answer, refused
 * the connection, or answered with a server error. The same distinction the
 * DNS pair draws, for the same reason: "we looked and it is not there" and
 * "we could not look" have different next steps, and only the first one is
 * the customer's. Stated as the customer's server being unreachable rather
 * than as our failure, but with the try-again copy, because a deploy mid-
 * flight and a hiccup of ours read identically from here.
 */
export class SsoDomainFetchFailedError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_domain_fetch_failed", "sso_domain_fetch_failed", {
      httpStatus: 503,
      fault: "provider",
      reasons: [new Error(detail)],
    });
    this.name = "SsoDomainFetchFailedError";
  }
}

/**
 * The record was found and has passed its expiry, so it proves nothing. The
 * way forward costs no progress: asking again issues a fresh record against
 * the same approved claim, and the approval is untouched.
 */
export class SsoDomainProofExpiredError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_domain_proof_expired", "sso_domain_proof_expired", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoDomainProofExpiredError";
  }
}

/**
 * The organization has not been opted in to setting single sign-on up itself
 * (D05 tier 3, the `SELF_SERVE_SSO` flag).
 *
 * The words offer talking to LangWatch and name no flag: a customer cannot
 * act on a flag name, and printing one turns a rollback lever into something
 * support has to explain.
 */
export class SsoSelfServeUnavailableError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_self_serve_unavailable", "sso_self_serve_unavailable", {
      httpStatus: 403,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoSelfServeUnavailableError";
  }
}

/**
 * A join-request refusal (D12).
 *
 * One of these is deliberately INDISTINGUISHABLE across several causes, and
 * that is the security property rather than an accident: `join_not_available`
 * answers an organization that does not exist, one that turned joining off,
 * one whose identity provider already admits people, and an address nobody
 * has verified — with the same code, the same status and the same words. A
 * refusal that said which would be an oracle for which organizations exist
 * and who works at them, which is the one thing this deliverable must not
 * build.
 */
export abstract class JoinRequestRefusedError extends HandledError {}

/**
 * Nothing here is open to you — and we will not say which of the several
 * possible reasons applies. Also the answer to naming an organization
 * directly that was never offered.
 */
export class JoinNotAvailableError extends JoinRequestRefusedError {
  constructor(detail: string) {
    super("join_not_available", "join_not_available", {
      httpStatus: 404,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "JoinNotAvailableError";
  }
}

/** The request is not this organization's to answer. Same shape as "there is
 *  no such request", because saying otherwise reveals another organization. */
export class JoinRequestNotFoundError extends JoinRequestRefusedError {
  constructor(detail: string) {
    super("join_request_not_found", "join_request_not_found", {
      httpStatus: 404,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "JoinRequestNotFoundError";
  }
}

/** Every ending is terminal: approve, reject, withdraw and expire all act on
 *  PENDING and nothing else. */
export class JoinRequestNotPendingError extends JoinRequestRefusedError {
  constructor(detail: string) {
    super("join_request_not_pending", "join_request_not_pending", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "JoinRequestNotPendingError";
  }
}

/** One open request per person per organization. A request costs an admin
 *  attention, so the cheapest attack on them is volume. */
export class JoinRequestAlreadyPendingError extends JoinRequestRefusedError {
  constructor(detail: string) {
    super("join_request_already_pending", "join_request_already_pending", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "JoinRequestAlreadyPendingError";
  }
}

/**
 * Asking, or looking organizations up, faster than the installation allows —
 * and the cool-down after a rejection, which is the same refusal on purpose:
 * a rejected person who could tell "you were rejected" from "you are going
 * too fast" has been told the rejection the silent-ish ending exists to keep
 * quiet.
 *
 * `retryAfterSeconds` comes off the limiter's own answer, so the screen says
 * how long is left rather than guessing.
 */
export class JoinRequestThrottledError extends JoinRequestRefusedError {
  constructor(retryAfterSeconds: number) {
    super("join_request_throttled", "join_request_throttled", {
      httpStatus: 429,
      fault: "customer",
      meta: { retryAfterSeconds },
    });
    this.name = "JoinRequestThrottledError";
  }
}

/**
 * Automatic joining was turned on for a domain nobody has proved: a consumer
 * mail provider, or a company domain only one member holds a verified address
 * on. The copy says company domains only and does not list the deny-list —
 * publishing it turns the refusal into a way to enumerate it.
 */
export class JoinAutoDomainUnprovenError extends JoinRequestRefusedError {
  constructor(detail: string) {
    super("join_auto_domain_unproven", "join_auto_domain_unproven", {
      httpStatus: 422,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "JoinAutoDomainUnprovenError";
  }
}

/** An organization whose identity provider already admits people cannot also
 *  admit them by domain: the connection's own provisioning is the way in. */
export class JoinAutoConnectionAdmitsError extends JoinRequestRefusedError {
  constructor(detail: string) {
    super("join_auto_connection_admits", "join_auto_connection_admits", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "JoinAutoConnectionAdmitsError";
  }
}

/**
 * The licence asymmetry, refused. Automatic joining is federation — the
 * deployment decides who counts as a colleague and admits them with nobody in
 * the loop — so the gate that has always held single sign-on holds this too.
 * Asking to join is NOT gated and never reaches here.
 */
export class JoinAutoNotLicensedError extends JoinRequestRefusedError {
  constructor(detail: string) {
    super("join_auto_not_licensed", "join_auto_not_licensed", {
      httpStatus: 403,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "JoinAutoNotLicensedError";
  }
}

/**
 * Opening the door at all — to people who ask, or to a domain that walks
 * straight in — is a paid capability of the organization's plan, and an
 * organization whose plan does not carry it is refused HERE rather than by
 * the screen. A greyed control is a courtesy to whoever is reading; this is
 * the boundary, and it holds for anything that reaches the command: another
 * tab, a stale page, a script.
 *
 * CLOSING the door is never refused for this reason. An organization that
 * leaves the plan with a policy already on must be able to shut it, or a
 * lapsed plan would be a door it cannot close — the same reasoning that keeps
 * turning the two-step requirement OFF ungated.
 *
 * Distinct from `JoinAutoNotLicensedError`, which asks a different question:
 * whether the DEPLOYMENT holds a genuine license to federate at all. Both can
 * refuse automatic joining, and they refuse it for different reasons.
 */
export class JoinPolicyNotLicensedError extends JoinRequestRefusedError {
  constructor(detail: string) {
    super("join_policy_not_licensed", "join_policy_not_licensed", {
      httpStatus: 403,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "JoinPolicyNotLicensedError";
  }
}

/**
 * A two-step verification refusal (D06). Handled for the usual reason: each
 * names a cause the person can act on, and the words they read live in the
 * app's presentation registry keyed by code.
 *
 * The one deliberate silence is `IdentityMfaCodeInvalidError`. A wrong code
 * and a code for an enrollment nobody holds answer identically, because
 * anything else turns the challenge endpoint into an oracle for whether an
 * account has two-step verification set up. Which of the two it was goes to
 * the log line, keyed by userId, and never to the response.
 */
export abstract class MfaCommandRefusedError extends HandledError {}

export class IdentityMfaCodeInvalidError extends MfaCommandRefusedError {
  constructor(detail: string) {
    super("identity_mfa_code_invalid", "identity_mfa_code_invalid", {
      httpStatus: 400,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityMfaCodeInvalidError";
  }
}

/**
 * The setup was started and never finished inside its window. Separable from
 * an invalid code because the remediation differs — start again, rather than
 * read the code more carefully — and because leaking that an UNCONFIRMED
 * setup expired tells an attacker nothing they could not already provoke.
 */
export class IdentityMfaEnrollmentExpiredError extends MfaCommandRefusedError {
  constructor(detail: string) {
    super(
      "identity_mfa_enrollment_expired",
      "identity_mfa_enrollment_expired",
      { httpStatus: 410, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "IdentityMfaEnrollmentExpiredError";
  }
}

/**
 * The plugin's lockout, surfaced under a code of ours. Counting failures and
 * deciding when to stop is the two-factor plugin's job and we do not rebuild
 * it; what we own is that the person is told what happened in words, rather
 * than being handed a bare "invalid code" that makes it look like they are
 * still typing it wrong.
 */
export class IdentityMfaLockedOutError extends MfaCommandRefusedError {
  constructor(detail: string) {
    super("identity_mfa_locked_out", "identity_mfa_locked_out", {
      httpStatus: 429,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityMfaLockedOutError";
  }
}

/** Every backup code has been spent, and the authenticator is gone too. */
export class IdentityMfaBackupCodesExhaustedError extends MfaCommandRefusedError {
  constructor(detail: string) {
    super(
      "identity_mfa_backup_codes_exhausted",
      "identity_mfa_backup_codes_exhausted",
      { httpStatus: 409, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "IdentityMfaBackupCodesExhaustedError";
  }
}

/**
 * Turning it off is refused while an organization the person belongs to
 * requires it. The detail names which organizations for the log; the copy
 * tells the person to leave the organization or ask an administrator, which
 * is the only thing that actually unblocks them.
 */
export class IdentityMfaRequiredByOrganizationError extends MfaCommandRefusedError {
  constructor(detail: string) {
    super(
      "identity_mfa_required_by_organization",
      "identity_mfa_required_by_organization",
      { httpStatus: 409, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "IdentityMfaRequiredByOrganizationError";
  }
}

/**
 * Requiring a second factor of every member is a paid capability, and an
 * organization whose plan does not carry it is refused HERE rather than by
 * the screen. A control that is greyed out is a courtesy to whoever is
 * reading; this is the boundary, and it holds for anything that reaches the
 * command — another tab, a stale page, a script.
 *
 * Turning the requirement OFF is never refused for this reason. An
 * organization that leaves the plan with the requirement already on has
 * members standing at an enrollment gate, and an administrator who could not
 * release them would have bought a lockout.
 */
export class IdentityMfaRequirementNotLicensedError extends MfaCommandRefusedError {
  constructor(detail: string) {
    super(
      "identity_mfa_requirement_not_licensed",
      "identity_mfa_requirement_not_licensed",
      { httpStatus: 403, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "IdentityMfaRequirementNotLicensedError";
  }
}

/**
 * The password re-proof turning it off asks for did not match.
 *
 * Named, unlike the code refusal, and for the opposite reason: this reveals
 * nothing an attacker could not already learn from the sign-in screen, and a
 * person who mistyped their password while turning two-step verification off
 * has to be told which of the two fields to look at. Collapsing it into the
 * code refusal would send them back to their authenticator for a password
 * mistake.
 */
export class IdentityMfaPasswordInvalidError extends MfaCommandRefusedError {
  constructor(detail: string) {
    super("identity_mfa_password_invalid", "identity_mfa_password_invalid", {
      httpStatus: 400,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityMfaPasswordInvalidError";
  }
}

/**
 * The enrollment gate: this organization requires a second factor and this
 * person cannot yet prove one. NOT an authentication failure — the session
 * is untouched and every other organization stays reachable — so it is 403
 * rather than 401, and the copy says "set one up", never "sign in again".
 */
export class IdentityMfaEnrollmentRequiredError extends MfaCommandRefusedError {
  constructor(detail: string) {
    super(
      "identity_mfa_enrollment_required",
      "identity_mfa_enrollment_required",
      { httpStatus: 403, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "IdentityMfaEnrollmentRequiredError";
  }
}

/**
 * A passkey refusal (D07). The ceremony ones stay vague for the same reason
 * the code refusal does: a browser ceremony that fails and a credential we
 * do not recognize must not be distinguishable, or the endpoint answers
 * "does this passkey exist here" for anybody who asks.
 */
export abstract class PasskeyCommandRefusedError extends HandledError {}

/**
 * The browser ceremony did not complete — cancelled, timed out, or refused
 * by the authenticator. Ordinary and recoverable: the person tries again or
 * picks another way in, and nothing about their account changed.
 */
export class IdentityPasskeyCeremonyFailedError extends PasskeyCommandRefusedError {
  constructor(detail: string) {
    super(
      "identity_passkey_ceremony_failed",
      "identity_passkey_ceremony_failed",
      { httpStatus: 400, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "IdentityPasskeyCeremonyFailedError";
  }
}

/**
 * The authenticator offered a credential this account already holds. Named
 * rather than left to the ceremony refusal because the action is different:
 * there is nothing to retry — the passkey is already there and already works
 * — and a person told "that attempt didn't finish" would sit trying the same
 * device again.
 */
export class IdentityPasskeyAlreadyRegisteredError extends PasskeyCommandRefusedError {
  constructor(detail: string) {
    super(
      "identity_passkey_already_registered",
      "identity_passkey_already_registered",
      { httpStatus: 409, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "IdentityPasskeyAlreadyRegisteredError";
  }
}

/** The credential presented is not one we hold — or is not one we hold for
 *  anybody. Deliberately the same answer either way. */
export class IdentityPasskeyNotRecognizedError extends PasskeyCommandRefusedError {
  constructor(detail: string) {
    super(
      "identity_passkey_not_recognized",
      "identity_passkey_not_recognized",
      { httpStatus: 400, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "IdentityPasskeyNotRecognizedError";
  }
}

/**
 * Removing this sign-in method would leave the person unable to get back in
 * — either with nothing verified at all, or with only passkeys and no
 * address anyone could recover them through. The same refusal covers both
 * because the remedy is the same shape: add another way in FIRST.
 */
export class IdentityDetachStrandsUserError extends IdentityCommandRefusedError {
  constructor(detail: string) {
    super("identity_detach_strands_user", "identity_detach_strands_user", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityDetachStrandsUserError";
  }
}

/**
 * The address being attached is already live somewhere — on this account, or
 * on somebody else's.
 *
 * ONE error for both readings, which is the whole point of it. Telling them
 * apart would answer "does an account exist for this address" to anybody
 * signed in anywhere, and the person who actually hits this is nearly always
 * adding their own address a second time — for whom "it is already yours" and
 * "use a different one" are the same instruction.
 */
export class IdentityIdentifierAlreadyHeldError extends IdentityCommandRefusedError {
  constructor(detail: string) {
    super(
      "identity_identifier_already_held",
      "identity_identifier_already_held",
      { httpStatus: 409, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "IdentityIdentifierAlreadyHeldError";
  }
}

/**
 * A password the policy will not take (`passwordProblem`). The refusal is
 * about the value that was typed, so it is the customer's and it is
 * actionable: type a different one.
 */
export class IdentityPasswordRejectedError extends IdentityCommandRefusedError {
  constructor(detail: string) {
    super("identity_password_rejected", "identity_password_rejected", {
      httpStatus: 400,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityPasswordRejectedError";
  }
}

/**
 * A password-reset link that will not spend: expired, already used, or never
 * issued.
 *
 * The three collapse to one for the same reason the two invalid-code variants
 * do: answering differently would say whether a link had ever existed and
 * whether it had been opened, and the way forward — request a new one — is
 * identical for all three.
 */
export class IdentityResetLinkInvalidError extends IdentityCommandRefusedError {
  constructor(detail: string) {
    super("identity_reset_link_invalid", "identity_reset_link_invalid", {
      httpStatus: 400,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityResetLinkInvalidError";
  }
}

/**
 * A credential sign-in that did not check out.
 *
 * The one load-bearing property is what it does NOT distinguish: a wrong
 * password for an account that exists and any password for an address nobody
 * holds are the same refusal, with the same code, the same status and the same
 * words (`specs/auth/sign-in-failure-messages.feature`,
 * `specs/auth/signup-does-not-strand-an-account.feature`). better-auth already
 * answers both with `INVALID_EMAIL_OR_PASSWORD`; this keeps that true once the
 * wire carries a code of ours instead.
 */
export class IdentitySignInRefusedError extends IdentityCommandRefusedError {
  constructor(detail: string) {
    super("identity_sign_in_refused", "identity_sign_in_refused", {
      httpStatus: 401,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentitySignInRefusedError";
  }
}

/**
 * The proposal named is not one this person has. Either it never existed, or
 * the operator is holding a stale page — the surface lists what is waiting,
 * so a proposal that is gone from the list is gone from here too.
 */
export class IdentityLinkProposalNotFoundError extends IdentityCommandRefusedError {
  constructor(detail: string) {
    super(
      "identity_link_proposal_not_found",
      "identity_link_proposal_not_found",
      { httpStatus: 404, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "IdentityLinkProposalNotFoundError";
  }
}

/**
 * Somebody already decided this proposal, so nobody may decide it again.
 *
 * The decision is carried in `meta` rather than only in the detail, because
 * the words an operator reads have to name what was decided and by whom —
 * two operators working the same support case is exactly how this refusal
 * happens, and "already decided" without the other half sends the second one
 * looking for a bug.
 */
export class IdentityLinkProposalResolvedError extends IdentityCommandRefusedError {
  constructor(
    detail: string,
    decision: { outcome: "confirmed" | "rejected"; byActorId: string | null },
  ) {
    super(
      "identity_link_proposal_resolved",
      "identity_link_proposal_resolved",
      {
        httpStatus: 409,
        fault: "customer",
        meta: {
          decidedOutcome: decision.outcome,
          decidedByActorId: decision.byActorId,
        },
        reasons: [new Error(detail)],
      },
    );
    this.name = "IdentityLinkProposalResolvedError";
  }
}

/**
 * An operator tried to impersonate into an organization that requires a
 * second factor without having set one up themselves. The requirement is
 * about the ACTOR, not the subject: borrowing somebody's access is a higher
 * bar than holding your own, not a way around the bar.
 */
export class CannotImpersonateWithoutSecondFactorError extends HandledError {
  constructor(detail: string) {
    super(
      "cannot_impersonate_without_second_factor",
      "cannot_impersonate_without_second_factor",
      { httpStatus: 403, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "CannotImpersonateWithoutSecondFactorError";
  }
}
