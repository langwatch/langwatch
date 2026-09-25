import { HandledError } from "@langwatch/handled-error";
import {
  IdentityCommandRefusedError,
  PasskeyCommandRefusedError,
} from "@langwatch/identity-contract";

export class AuthValidateRateLimitedError extends HandledError {
  declare readonly code: "auth_validate_rate_limited";

  constructor(input: { retryAfterSeconds?: number | undefined }) {
    super("auth_validate_rate_limited", "Too many token validation attempts from this address", {
      httpStatus: 429,
      retryable: true,
      fault: "customer",
      ...(input.retryAfterSeconds !== undefined
        ? { meta: { retryAfterSeconds: input.retryAfterSeconds } }
        : {}),
    });
    this.name = "AuthValidateRateLimitedError";
  }
}

export class AuthUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(input: { capability: string; processName: string }) {
    super("service_unavailable", `${input.processName} composes no ${input.capability}.`, {
      httpStatus: 503,
      fault: "platform",
      meta: { capability: input.capability },
    });
    this.name = "AuthUnavailableError";
  }
}

export class NoAddressToConfirmError extends HandledError {
  constructor() {
    super("auth_no_address_to_confirm", "This account has no email address to confirm.", {
      httpStatus: 400,
    });
    this.name = "NoAddressToConfirmError";
  }
}

export class FrontDoorRateLimitedError extends HandledError {
  declare readonly code: "auth_rate_limited";

  /** `retryAfterSeconds` is what `auth_rate_limited`'s presentation entry
   *  reads to name the wait; without it the customer is told "a few minutes". */
  constructor(message: string, input: { retryAfterSeconds?: number | undefined } = {}) {
    super("auth_rate_limited", message, {
      httpStatus: 429,
      retryable: true,
      ...(input.retryAfterSeconds !== undefined
        ? { meta: { retryAfterSeconds: input.retryAfterSeconds } }
        : {}),
    });
    this.name = "FrontDoorRateLimitedError";
  }
}

/**
 * Named rather than silently refused: "nothing happened" and "that one is
 * yours" look identical on a list, and the second has an action attached to
 * it — sign out — that the first does not.
 */
export class SessionIsCurrentError extends HandledError {
  declare readonly code: "session_is_current";

  constructor() {
    super(
      "session_is_current",
      "Signing out of the browser you are reading this in is a different act; use the sign-out control.",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "SessionIsCurrentError";
  }
}

/**
 * This address is locked out after repeated failures (GAC-09). The message
 * names neither whether the address has an account nor which half of the
 * credentials was right: either makes the screen an oracle.
 */
export class SignInLockedOutError extends HandledError {
  declare readonly code: "identity_sign_in_locked_out";

  constructor(detail: string) {
    super("identity_sign_in_locked_out", "identity_sign_in_locked_out", {
      httpStatus: 429,
      fault: "customer",
      retryable: true,
      reasons: [new Error(detail)],
    });
    this.name = "SignInLockedOutError";
  }
}

/**
 * A session-window save named a ceiling shorter than the idle timeout beside
 * it (GAC-10). Refused rather than accepted: a session that ends at the
 * ceiling before it could ever go idle makes the idle timeout unreachable.
 */
export class SessionMaxLifetimeTooShortError extends HandledError {
  declare readonly code: "identity_session_max_lifetime_too_short";

  constructor(detail: string) {
    super("identity_session_max_lifetime_too_short", "identity_session_max_lifetime_too_short", {
      httpStatus: 422,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "SessionMaxLifetimeTooShortError";
  }
}

/** The two-field body RFC 8628 device-grant clients parse from every refusal. */
export type CliDeviceFlowRefusal = Readonly<{ error: string; error_description: string }>;

/**
 * A device-grant refusal at the status the flow names, carrying the RFC 8628
 * body released CLI builds parse. The route's refusal renderer writes it as is.
 */
export class CliDeviceFlowRefusedError extends HandledError {
  declare readonly code: "cli_device_flow_refused";
  readonly refusal: CliDeviceFlowRefusal;

  constructor(input: { refusal: CliDeviceFlowRefusal; httpStatus: number }) {
    super("cli_device_flow_refused", input.refusal.error_description, {
      httpStatus: input.httpStatus,
      fault: input.httpStatus >= 500 ? "platform" : "customer",
      meta: { error: input.refusal.error },
    });
    this.name = "CliDeviceFlowRefusedError";
    this.refusal = input.refusal;
  }
}

/** No CLI session record at a key: never minted, expired, or already consumed. */
export class CliSessionRecordNotFoundError extends HandledError {
  declare readonly code: "cli_session_record_not_found";

  constructor() {
    super("cli_session_record_not_found", "This sign-in session no longer exists", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "CliSessionRecordNotFoundError";
  }
}

/** The password re-proof turning two-step verification off did not match; the code was fine. */
export class TwoStepPasswordInvalidError extends HandledError {
  declare readonly code: "identity_mfa_password_invalid";

  constructor(detail: string) {
    super("identity_mfa_password_invalid", "identity_mfa_password_invalid", {
      httpStatus: 400,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "TwoStepPasswordInvalidError";
  }
}

/** Sign-up asked for a password account where the address's organization signs in through SSO. */
export class DirectRegistrationUnavailableError extends HandledError {
  declare readonly code: "auth_direct_registration_unavailable";

  constructor() {
    super("auth_direct_registration_unavailable", "auth_direct_registration_unavailable", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "DirectRegistrationUnavailableError";
  }
}

/** A credential sign-in that did not check out; a wrong password and an unheld address match. */
export class IdentitySignInRefusedError extends IdentityCommandRefusedError {
  declare readonly code: "identity_sign_in_refused";

  constructor(detail: string) {
    super("identity_sign_in_refused", "identity_sign_in_refused", {
      httpStatus: 401,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentitySignInRefusedError";
  }
}

/** A password the policy will not take; type a different one. */
export class IdentityPasswordRejectedError extends IdentityCommandRefusedError {
  declare readonly code: "identity_password_rejected";

  constructor(detail: string) {
    super("identity_password_rejected", "identity_password_rejected", {
      httpStatus: 400,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityPasswordRejectedError";
  }
}

/** A password-reset link that will not spend: expired, used or never issued, all alike. */
export class IdentityResetLinkInvalidError extends IdentityCommandRefusedError {
  declare readonly code: "identity_reset_link_invalid";

  constructor(detail: string) {
    super("identity_reset_link_invalid", "identity_reset_link_invalid", {
      httpStatus: 400,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityResetLinkInvalidError";
  }
}

/** The authenticator offered a passkey this account already holds; there is nothing to retry. */
export class IdentityPasskeyAlreadyRegisteredError extends PasskeyCommandRefusedError {
  declare readonly code: "identity_passkey_already_registered";

  constructor(detail: string) {
    super("identity_passkey_already_registered", "identity_passkey_already_registered", {
      httpStatus: 409,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityPasskeyAlreadyRegisteredError";
  }
}
