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
