import { HandledError, NotFoundError } from "@langwatch/handled-error";

import type { SsoMigrationBlockerView } from "./sso-migration.ts";

/**
 * Every identity refusal in one place (ADR-045: handled since the cause is
 * known and the caller can act). Assert on `code`, never the message.
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
    super("identity_identifier_not_verifiable", "identity_identifier_not_verifiable", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityIdentifierNotVerifiableError";
  }
}

export class IdentityPrimaryMustDemoteFirstError extends IdentityCommandRefusedError {
  constructor(detail: string) {
    super("identity_primary_must_demote_first", "identity_primary_must_demote_first", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityPrimaryMustDemoteFirstError";
  }
}

/**
 * Cross-population uniqueness refusal (ADR-116 §6): the address already
 * belongs to somebody else, in either population. Refused at VERIFY and
 * PRIMARY only, or a PRIMARY switch dies unfriendly deep in the fold.
 */
export class IdentityEmailInUseError extends IdentityCommandRefusedError {
  constructor(detail: string) {
    super("identity_email_in_use", "identity_email_in_use", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
      tips: ["Sign in with the account that already holds this address, or use a different one."],
    });
    this.name = "IdentityEmailInUseError";
  }
}

export class IdentityPrimaryRequiresVerifiedError extends IdentityCommandRefusedError {
  constructor(detail: string) {
    super("identity_primary_requires_verified", "identity_primary_requires_verified", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityPrimaryRequiresVerifiedError";
  }
}

/**
 * A verification ceremony refusal. Two codes only: every pin/proof failure
 * answers `identity_verification_invalid` (reason logged, keyed by
 * verificationId); expiry is separate since its remedy differs.
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

/**
 * The completion ceremony could not confirm either outcome yet — the gap
 * between VERIFIED and DEAD_END, separate from `invalid` and `expired`.
 * `platform` fault and a 5xx on purpose: a run of these means the fold lags.
 */
export class IdentityVerificationNotSettledError extends HandledError {
  constructor() {
    super("identity_verification_not_settled", "identity_verification_not_settled", {
      httpStatus: 503,
      fault: "platform",
      tips: ["Open the same link again in a moment."],
    });
    this.name = "IdentityVerificationNotSettledError";
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
 * An SSO connection guard's refusal (ADR-117 §5, D04): each names a cause an
 * operator can act on; the detail string is logged, never shown.
 */
export abstract class SsoConnectionCommandRefusedError extends HandledError {}

export class SsoConnectionInvalidTransitionError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_connection_invalid_transition", "sso_connection_invalid_transition", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoConnectionInvalidTransitionError";
  }
}

/**
 * Finalization was asked for while something still says it is premature. The
 * blocker codes travel in `meta` so the screen can name each one; the
 * messages are the words a reader acts on.
 */
export class SsoMigrationFinalizationBlockedError extends SsoConnectionCommandRefusedError {
  constructor(blockers: readonly SsoMigrationBlockerView[]) {
    super("sso_migration_finalization_blocked", "sso_migration_finalization_blocked", {
      httpStatus: 409,
      fault: "customer",
      meta: { blockerCodes: blockers.map(({ code }) => code) },
      reasons: blockers.map(({ message }) => new Error(message)),
    });
    this.name = "SsoMigrationFinalizationBlockedError";
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

/** A domain no organization could own alone: a shared mail provider, a
 *  registry suffix or a bare label. The copy lists nothing, so the refusal
 *  cannot be used to read the deny-list back. */
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

/** More domains claimed in the window than a connection is allowed; the wait
 *  rides in `meta` so the screen counts down from the guard's own answer. */
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
    super("sso_connection_activation_blocked", "sso_connection_activation_blocked", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoConnectionActivationBlockedError";
  }
}

/**
 * Teardown would leave people with no way in. The detail carries how many
 * users for the log; the copy tells the operator what to do about it, which
 * is give those people another verified method first.
 */
export class SsoConnectionTeardownStrandsUsersError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_connection_teardown_strands_users", "sso_connection_teardown_strands_users", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoConnectionTeardownStrandsUsersError";
  }
}

/**
 * Somebody other than a platform operator tried to attest or decide a
 * domain claim. Refused in the guard so it holds for every caller; the
 * copy names how the domain IS proved rather than only saying no.
 */
export class SsoConnectionOperatorActRequiredError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_connection_operator_act_required", "sso_connection_operator_act_required", {
      httpStatus: 403,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoConnectionOperatorActRequiredError";
  }
}

/**
 * A SAML connection registered through a self-serve surface. Refused by name
 * rather than accepted and left dark: D05 is OIDC only, and which engine
 * terminates SAML is a D09 decision made per named customer connection.
 */
export class SsoSamlNotSelfServeError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_saml_not_self_serve", "sso_saml_not_self_serve", {
      httpStatus: 422,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoSamlNotSelfServeError";
  }
}

/**
 * A legacy `ssoDomain`/`ssoProvider` edit after the routing flip. Refused,
 * not silently ignored: once the projection decides sign-in, the edit
 * changes nothing, and accepting it fools a staff member into thinking so.
 */
export class SsoConnectionStringEditRetiredError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_connection_string_edit_retired", "sso_connection_string_edit_retired", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoConnectionStringEditRetiredError";
  }
}

/** The id a registration asked for is held by a connection that is not the
 *  one being registered. */
export class SsoConnectionAlreadyRegisteredError extends SsoConnectionCommandRefusedError {
  constructor(detail: string) {
    super("sso_connection_already_registered", "sso_connection_already_registered", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoConnectionAlreadyRegisteredError";
  }
}

/**
 * Missing and foreign connections share one refusal, so no caller can use
 * the difference as an oracle for which connections exist.
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

/** Somebody else's claim on this domain is still waiting on a decision, so
 *  issuing a proof against it would decide it by the back door. */
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

/** The record we asked for is not published yet (D05 tier 3). A refusal
 *  rather than a retry loop: the record stays on screen, unchanged. */
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

/** The record was found and has passed its expiry, so it proves nothing.
 *  Asking again issues a fresh one against the same approved claim. */
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
 * We could not READ the domain at all — a resolver that timed out or a fetch
 * that never happened. Distinct from `sso_domain_proof_not_found`: "it is
 * not there" is a customer's next step, "we could not look" is not.
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

/**
 * A join-request refusal (D12). `join_not_available` is deliberately
 * INDISTINGUISHABLE across causes — naming which would be an oracle for
 * which organizations exist.
 */
export abstract class JoinRequestRefusedError extends HandledError {}

/** Nothing here is open to you — we will not say which of the several
 *  possible reasons applies, including naming an org never offered. */
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
 * Asking too fast and the cool-down after a rejection share this refusal —
 * telling them apart would reveal the rejection. `retryAfterSeconds` comes
 * off the limiter's own answer, never a guess.
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
 * Automatic joining turned on for an unproven domain: a consumer mail
 * provider, or a company domain only one member has verified. The copy
 * omits the deny-list — publishing it would let it be enumerated.
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
 * The licence asymmetry, refused: automatic joining is federation (nobody
 * in the loop), so the gate that has always held single sign-on holds
 * this too. Asking to join is NOT gated and never reaches here.
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
 * Opening the door wider is a paid control of the organization's plan, refused
 * here rather than by the screen. Closing it is never refused for this reason,
 * or a lapsed plan would leave a door the organization cannot shut.
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
 * A two-step verification refusal (D06). `IdentityMfaCodeInvalidError` is
 * deliberately silent: a wrong code and one for an enrollment nobody holds
 * answer identically, or the endpoint becomes an MFA-existence oracle.
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
 * Setup started and never finished inside its window. Separable from an
 * invalid code since the remedy differs (start again, not retype), and
 * leaking an expired UNCONFIRMED setup tells an attacker nothing new.
 */
export class IdentityMfaEnrollmentExpiredError extends MfaCommandRefusedError {
  constructor(detail: string) {
    super("identity_mfa_enrollment_expired", "identity_mfa_enrollment_expired", {
      httpStatus: 410,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityMfaEnrollmentExpiredError";
  }
}

/**
 * The plugin's lockout, surfaced under a code of ours — counting failures is
 * the two-factor plugin's job, not ours; we own telling the person what
 * happened instead of a bare "invalid code".
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
    super("identity_mfa_backup_codes_exhausted", "identity_mfa_backup_codes_exhausted", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityMfaBackupCodesExhaustedError";
  }
}

/**
 * Turning it off is refused while a member organization requires it. The
 * detail names which organizations, for the log; the copy tells the person
 * to leave it or ask an administrator — the only thing that unblocks them.
 */
export class IdentityMfaRequiredByOrganizationError extends MfaCommandRefusedError {
  constructor(detail: string) {
    super("identity_mfa_required_by_organization", "identity_mfa_required_by_organization", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityMfaRequiredByOrganizationError";
  }
}

/**
 * The enrollment gate: this org requires a second factor the person cannot
 * yet prove. NOT an authentication failure — the session is untouched — so
 * it is 403 not 401, and the copy says "set one up", not "sign in again".
 */
export class IdentityMfaEnrollmentRequiredError extends MfaCommandRefusedError {
  constructor(detail: string) {
    super("identity_mfa_enrollment_required", "identity_mfa_enrollment_required", {
      httpStatus: 403,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityMfaEnrollmentRequiredError";
  }
}

/**
 * A passkey refusal (D07): a failed browser ceremony and an unrecognized
 * credential stay indistinguishable, or the endpoint answers "does this
 * passkey exist here" for anybody who asks.
 */
export abstract class PasskeyCommandRefusedError extends HandledError {}

/** The browser ceremony did not complete — cancelled, timed out, or refused
 *  by the authenticator. Ordinary and recoverable: nothing about the
 *  account changed. */
export class IdentityPasskeyCeremonyFailedError extends PasskeyCommandRefusedError {
  constructor(detail: string) {
    super("identity_passkey_ceremony_failed", "identity_passkey_ceremony_failed", {
      httpStatus: 400,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityPasskeyCeremonyFailedError";
  }
}

/** The credential presented is not one we hold — or is not one we hold for
 *  anybody. Deliberately the same answer either way. */
export class IdentityPasskeyNotRecognizedError extends PasskeyCommandRefusedError {
  constructor(detail: string) {
    super("identity_passkey_not_recognized", "identity_passkey_not_recognized", {
      httpStatus: 400,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityPasskeyNotRecognizedError";
  }
}

/** Raised when an operation would leave a person unable to sign in or when a capability (e.g. SSO)
 * is unavailable due to deployment configuration.
 */
export class IdentityCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
      meta: { capability },
    });
    this.name = "IdentityCapabilityUnavailableError";
  }
}

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
 * The event-sourcing stack could not accept the newborn's facts.
 * This is the coupling ADR-116 §3 re-introduces on purpose and scopes to the
 * one call that must not silently succeed without a ledger entry.
 */
export class IdentityEngineUnavailableError extends HandledError {
  constructor(detail: string, cause: unknown) {
    super("identity_engine_unavailable", "identity_engine_unavailable", {
      httpStatus: 503,
      fault: "platform",
      reasons: [new Error(detail), ...(cause instanceof Error ? [cause] : [])],
      tips: ["Try creating the account again in a moment."],
    });
    this.name = "IdentityEngineUnavailableError";
  }
}

/**
 * An `account` storage operation the identity branch does not serve.
 * `fault: "platform"` — nothing the customer did caused it. Held as a
 * constant so a reader recognizes the code across a package boundary.
 */
export const IDENTITY_UNSUPPORTED_STORAGE_QUERY_CODE = "identity_unsupported_storage_query";

export class IdentityUnsupportedStorageQueryError extends HandledError {
  declare readonly code: "identity_unsupported_storage_query";

  constructor(detail: string) {
    super(IDENTITY_UNSUPPORTED_STORAGE_QUERY_CODE, "identity_unsupported_storage_query", {
      httpStatus: 500,
      fault: "platform",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityUnsupportedStorageQueryError";
  }
}

/**
 * A grant naming somebody who could not use the way in satisfies the
 * activation precondition and satisfies nothing real: the connection goes
 * live, the provider misbehaves, and the promised door opens for nobody.
 */
export class SsoBreakGlassHolderIneligibleError extends SsoConnectionCommandRefusedError {
  constructor(userId: string) {
    super("sso_break_glass_holder_ineligible", "sso_break_glass_holder_ineligible", {
      httpStatus: 422,
      fault: "customer",
      meta: { userId },
    });
    this.name = "SsoBreakGlassHolderIneligibleError";
  }
}

/**
 * An expiry in the past, or further out than a way in may be granted for. The
 * expiry is the whole of what stops a named local door becoming a permanent
 * second one, and the warning sweep only looks fourteen days ahead.
 */
export class SsoBreakGlassExpiryOutOfRangeError extends SsoConnectionCommandRefusedError {
  constructor(maxWindowDays: number) {
    super("sso_break_glass_expiry_out_of_range", "sso_break_glass_expiry_out_of_range", {
      httpStatus: 422,
      fault: "customer",
      meta: { maxWindowDays },
    });
    this.name = "SsoBreakGlassExpiryOutOfRangeError";
  }
}

/**
 * Revoking this grant would leave a live connection with no way back in — the
 * one lever for the identity provider failing, removed while the identity
 * provider is what decides sign-in. Grant somebody else first.
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
 * The refusals the sign-in gate answers an assertion with. A cause is NAMED
 * when it is a fact about the caller's own assertion or configuration; it
 * stays opaque when naming it would say what exists here (ADR-117 §5).
 */
export abstract class SsoAssertionRefusedError extends HandledError {}

/**
 * The general refusal: we will not say which cause fired. Deliberately NOT
 * `identity_sign_in_refused`, which is the CREDENTIAL refusal and has to keep
 * meaning "that email or password is wrong" for exactly one thing.
 */
export class SsoSignInRefusedError extends SsoAssertionRefusedError {
  constructor(detail: string) {
    super("sso_sign_in_refused", "sso_sign_in_refused", {
      httpStatus: 403,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoSignInRefusedError";
  }
}

/**
 * The provider authenticated somebody and released no email address — the
 * most common enterprise misconfiguration there is, and a fact about their
 * own application rather than about ours.
 */
export class SsoAssertionWithoutAddressError extends SsoAssertionRefusedError {
  constructor(detail: string) {
    super("sso_assertion_without_address", "sso_assertion_without_address", {
      httpStatus: 403,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoAssertionWithoutAddressError";
  }
}

/**
 * The connection is not live and the address asserted is not the
 * registrant's. Named for the ADDRESS, not the state: setup tells this
 * administrator to sign in, so naming the state misdirects the one who can act.
 */
export class SsoSetupAddressMismatchError extends SsoAssertionRefusedError {
  constructor(detail: string) {
    super("sso_setup_address_mismatch", "sso_setup_address_mismatch", {
      httpStatus: 403,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoSetupAddressMismatchError";
  }
}

/**
 * A live connection asserted an address on a domain it never proved. The
 * proof is the entire basis for trusting the provider's `email_verified`; the
 * remedy is a claim and a published record.
 */
export class SsoDomainNotVerifiedError extends SsoAssertionRefusedError {
  constructor(detail: string) {
    super("sso_domain_not_verified", "sso_domain_not_verified", {
      httpStatus: 403,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoDomainNotVerifiedError";
  }
}

/**
 * The domain's record stayed missing through its grace window and this person
 * is not already bound to the connection (ADR-123). Worth saying rather than
 * leaving them to guess why a colleague can sign in and they cannot.
 */
export class SsoDomainProofLapsedError extends SsoAssertionRefusedError {
  constructor(detail: string) {
    super("sso_domain_proof_lapsed", "sso_domain_proof_lapsed", {
      httpStatus: 403,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SsoDomainProofLapsedError";
  }
}

/**
 * A registration that named a protocol and then left out what that protocol
 * cannot work without. Refused at COMMAND time, before a fact is written.
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
 * The issuer an administrator typed did not answer as one. `fault` is the
 * customer's deliberately: the address is theirs and so is the fix, even
 * though the failure happened on somebody else's server.
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

/** The document pasted in is not an identity provider descriptor, or carries
 *  no signing certificate to trust assertions against. */
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

/** The signing certificate's bytes could not be read. Says nothing about
 *  whether the key inside signs anything — only a sign-in answers that. */
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
 * Somebody signed in to prove a connection is being offered a workspace of
 * their own: creating one strands the real organization's setup behind a
 * second, empty one. Refused rather than hidden — the screen is reachable.
 */
export class SsoTestArrivalCannotCreateOrganizationError extends HandledError {
  constructor(detail: string) {
    super(
      "sso_test_arrival_cannot_create_organization",
      "sso_test_arrival_cannot_create_organization",
      { httpStatus: 409, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "SsoTestArrivalCannotCreateOrganizationError";
  }
}

/** No sync folded for this connection in this organization yet; a foreign
 *  organization's sync reads the same, so the difference is no oracle. */
export class ScimSyncNotFoundError extends NotFoundError {
  declare readonly code: "scim_sync_not_found";

  constructor(scimSyncId: string) {
    super("scim_sync_not_found", "SCIM sync", scimSyncId, { meta: { scimSyncId } });
    this.name = "ScimSyncNotFoundError";
  }
}

/**
 * The identity lookup, refused: a 404 so the surface does not confirm it exists
 * to a caller outside the ADMIN_EMAILS staff list. No identifying fields.
 */
export class IdentityLookupNotFoundError extends HandledError {
  declare readonly code: "identity_lookup_not_found";

  constructor() {
    super("identity_lookup_not_found", "Not found", { httpStatus: 404, fault: "customer" });
    this.name = "IdentityLookupNotFoundError";
  }
}
