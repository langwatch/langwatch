import { HandledError } from "@langwatch/handled-error";

import { remediation } from "~/server/app-layer/error-remediation";

/**
 * The project holds no secret under the requested name.
 *
 * Handled rather than a plain `Error`: the caller named the secret, so the
 * cause is known and the one step open to them is to store it or correct the
 * name. Product-owned rows answer with this too, so the response never
 * confirms a reserved secret exists.
 */
export class SecretNotFoundError extends HandledError {
  declare readonly code: "secret_not_found";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "secret_not_found",
      "This project holds no secret under that name. Store it first, or check the name.",
      {
        httpStatus: 404,
        fault: "customer",
        ...remediation("secret_not_found"),
        ...options,
      },
    );
    this.name = "SecretNotFoundError";
  }
}

/**
 * The stored value exists but cannot be decrypted, which happens when the
 * instance's encryption key changed after the value was written.
 *
 * Handled with a platform fault: the customer did nothing wrong and cannot
 * repair the stored bytes, but they can act, by writing the secret again.
 * Nothing here names the key or the algorithm.
 */
export class SecretValueUnreadableError extends HandledError {
  declare readonly code: "secret_value_unreadable";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "secret_value_unreadable",
      "The stored value for this secret cannot be read back. Store the secret again to replace it.",
      {
        httpStatus: 500,
        fault: "platform",
        ...remediation("secret_value_unreadable"),
        ...options,
      },
    );
    this.name = "SecretValueUnreadableError";
  }
}
