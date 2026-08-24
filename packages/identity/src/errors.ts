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
