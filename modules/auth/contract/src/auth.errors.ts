import { HandledError } from "@langwatch/handled-error";

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
