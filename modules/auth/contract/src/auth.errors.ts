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
  constructor(message: string) {
    super("auth_rate_limited", message, { httpStatus: 429, retryable: true });
    this.name = "FrontDoorRateLimitedError";
  }
}
