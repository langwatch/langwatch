/**
 * Handled errors of the one-time reveal (ADR-045): the two ways a reveal id
 * can fail to answer, both of which the caller acts on the same way, by
 * creating a new key when the secret was not saved.
 */
import { HandledError } from "@langwatch/handled-error";
import { remediation } from "../app-layer/error-remediation";

export class SecretAlreadyRevealedError extends HandledError {
  declare readonly code: "secret_already_revealed";

  constructor(revealId: string) {
    super(
      "secret_already_revealed",
      "This key was shown once and cannot be shown again. Create a new key if you did not save it.",
      {
        httpStatus: 410,
        fault: "customer",
        meta: { revealId },
        ...remediation("secret_already_revealed"),
      },
    );
    this.name = "SecretAlreadyRevealedError";
  }
}

export class SecretRevealExpiredError extends HandledError {
  declare readonly code: "secret_reveal_expired";

  constructor(revealId: string) {
    super(
      "secret_reveal_expired",
      "This key can no longer be shown. Create a new key if you did not save it.",
      {
        httpStatus: 410,
        fault: "customer",
        meta: { revealId },
        ...remediation("secret_reveal_expired"),
      },
    );
    this.name = "SecretRevealExpiredError";
  }
}
