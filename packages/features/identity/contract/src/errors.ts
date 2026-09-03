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
 * rather than accepted and left dark: D05 is OIDC only, the aggregate is
 * protocol-agnostic on purpose, and which engine terminates SAML is a
 * decision D09 makes against a named customer's connection. The words say to
 * talk to LangWatch and name no engine, library or release.
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
 * A legacy `ssoDomain` / `ssoProvider` edit after the routing flip. Refused
 * rather than ignored: once the connection projection decides sign-in, a
 * string edit changes nothing a person would experience, and silently
 * accepting one leaves a staff member believing they fixed something.
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
    super("identity_mfa_enrollment_expired", "identity_mfa_enrollment_expired", {
      httpStatus: 410,
      fault: "customer",
      reasons: [new Error(detail)],
    });
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
    super("identity_mfa_backup_codes_exhausted", "identity_mfa_backup_codes_exhausted", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
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
    super("identity_mfa_required_by_organization", "identity_mfa_required_by_organization", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityMfaRequiredByOrganizationError";
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
    super("identity_mfa_enrollment_required", "identity_mfa_enrollment_required", {
      httpStatus: 403,
      fault: "customer",
      reasons: [new Error(detail)],
    });
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
 * An operator tried to impersonate into an organization that requires a
 * second factor without having set one up themselves. The requirement is
 * about the ACTOR, not the subject: borrowing somebody's access is a higher
 * bar than holding your own, not a way around the bar.
 */
export class CannotImpersonateWithoutSecondFactorError extends HandledError {
  constructor(detail: string) {
    super("cannot_impersonate_without_second_factor", "cannot_impersonate_without_second_factor", {
      httpStatus: 403,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "CannotImpersonateWithoutSecondFactorError";
  }
}
