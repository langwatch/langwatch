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
