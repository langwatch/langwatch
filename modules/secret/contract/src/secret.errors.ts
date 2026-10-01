import { HandledError } from "@langwatch/handled-error";

import { MAX_SECRETS_PER_PROJECT } from "./secret.ts";

export class SecretNotFoundError extends HandledError {
  declare readonly code: "secret_not_found";

  constructor() {
    super("secret_not_found", "Secret not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "SecretNotFoundError";
  }
}

export class SecretReservedNameError extends HandledError {
  declare readonly code: "secret_name_reserved";

  constructor(name: string) {
    super("secret_name_reserved", `The name "${name}" is reserved`, {
      meta: { name },
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "SecretReservedNameError";
  }
}

export class SecretLimitReachedError extends HandledError {
  declare readonly code: "secret_limit_reached";

  constructor(limit = MAX_SECRETS_PER_PROJECT) {
    super("secret_limit_reached", `Maximum of ${limit} secrets per project reached`, {
      meta: { limit },
      httpStatus: 412,
      fault: "customer",
    });
    this.name = "SecretLimitReachedError";
  }
}

export class SecretDuplicateError extends HandledError {
  declare readonly code: "secret_already_exists";

  constructor(name: string) {
    super(
      "secret_already_exists",
      `A secret with the name "${name}" already exists in this project`,
      { meta: { name }, httpStatus: 409, fault: "customer" },
    );
    this.name = "SecretDuplicateError";
  }
}

/**
 * A reveal id read twice. Told apart from an expired one deliberately: the
 * customer's next move is the same either way, but an operator reading the
 * log needs to know whether the secret was served or never arrived.
 */
export class SecretAlreadyRevealedError extends HandledError {
  declare readonly code: "secret_already_revealed";

  constructor(revealId: string) {
    super(
      "secret_already_revealed",
      "This key was shown once and cannot be shown again. Create a new key if you did not save it.",
      { meta: { revealId }, httpStatus: 410, fault: "customer" },
    );
    this.name = "SecretAlreadyRevealedError";
  }
}

/** A reveal id with nothing behind it: it expired, or was never stashed. The
 *  same refusal for both, because telling them apart would say whether an id
 *  somebody guessed was ever real. */
export class SecretRevealExpiredError extends HandledError {
  declare readonly code: "secret_reveal_expired";

  constructor(revealId: string) {
    super(
      "secret_reveal_expired",
      "This key can no longer be shown. Create a new key if you did not save it.",
      { meta: { revealId }, httpStatus: 410, fault: "customer" },
    );
    this.name = "SecretRevealExpiredError";
  }
}
