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
    super(
      "sso_connection_string_edit_retired",
      "sso_connection_string_edit_retired",
      { httpStatus: 409, fault: "customer", reasons: [new Error(detail)] },
    );
    this.name = "SsoConnectionStringEditRetiredError";
  }
}
