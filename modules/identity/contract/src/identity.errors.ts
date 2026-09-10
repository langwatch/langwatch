import { HandledError } from "@langwatch/handled-error";

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

/**
 * Removing this sign-in method would leave the person unable to get back
 * in. Covers both "nothing verified" and "only passkeys, no recoverable
 * address" — same remedy shape: add another way in FIRST.
 */
/**
 * The SSO connection write surface, refused by name rather than answered
 * emptily: this deployment composed the identity app with no SSO connection
 * store, so `ssoConnections`/`ssoBackoffice` have nothing to write through.
 * Same code and shape as `OrganizationCapabilityUnavailableError`.
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
