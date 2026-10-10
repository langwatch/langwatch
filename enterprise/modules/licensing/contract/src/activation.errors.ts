// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Refusals of an activation-code redemption (ADR-156, section 5). The route is
 * public and unauthenticated, so each refusal says only what the person
 * holding the code can act on and never whose code it is.
 */

import { HandledError } from "@langwatch/handled-error";

/** The text presented is not shaped like a code at all. */
export class ActivationCodeMalformedError extends HandledError {
  declare readonly code: "activation_code_malformed";

  constructor() {
    super("activation_code_malformed", "An activation code is LW followed by sixteen characters", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "ActivationCodeMalformedError";
  }
}

/**
 * No such code. A revoked code answers this too: which of the two it is would
 * tell the caller something about our customers.
 */
export class ActivationCodeNotFoundError extends HandledError {
  declare readonly code: "activation_code_not_found";

  constructor() {
    super("activation_code_not_found", "This activation code is not one we issued", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "ActivationCodeNotFoundError";
  }
}

/** The code's own term ended, which is not the term of what it would mint. */
export class ActivationCodeExpiredError extends HandledError {
  declare readonly code: "activation_code_expired";

  constructor() {
    super("activation_code_expired", "This activation code has expired", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "ActivationCodeExpiredError";
  }
}

/** A single-use code another install already claimed. */
export class ActivationCodeAlreadyRedeemedError extends HandledError {
  declare readonly code: "activation_code_already_redeemed";

  constructor() {
    super("activation_code_already_redeemed", "This activation code has already been used", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "ActivationCodeAlreadyRedeemedError";
  }
}

/** Too many attempts against one code, which is what bounds guessing it. */
export class ActivationRateLimitedError extends HandledError {
  declare readonly code: "activation_rate_limited";

  constructor() {
    super("activation_rate_limited", "Too many activation attempts; try again shortly", {
      httpStatus: 429,
      fault: "customer",
    });
    this.name = "ActivationRateLimitedError";
  }
}
