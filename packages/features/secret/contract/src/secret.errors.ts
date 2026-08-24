import { HandledError } from "@langwatch/handled-error";
import { MAX_SECRETS_PER_PROJECT } from "./secret";

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
    super(
      "secret_limit_reached",
      `Maximum of ${limit} secrets per project reached`,
      { meta: { limit }, httpStatus: 412, fault: "customer" },
    );
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
