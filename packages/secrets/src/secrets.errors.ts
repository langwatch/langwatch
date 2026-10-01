import { HandledError } from "@langwatch/handled-error";

/** A resolve after boot finished: the capability is gone, on purpose. */
export class SealedSecretsError extends HandledError {
  constructor(id: string) {
    super(
      "secret_sealed",
      `The secret "${id}" was resolved after boot. Secrets resolve only while modules construct.`,
      { fault: "platform" },
    );
  }
}

/** A create asked for a handle its owner never declared. */
export class UndeclaredSecretError extends HandledError {
  constructor(owner: string, id: string) {
    super(
      "secret_undeclared",
      `"${owner}" resolved the secret "${id}" without declaring it. Declare the handle where the owner is defined.`,
      { fault: "platform" },
    );
  }
}

/** A required secret no adapter answered, refused by its one id. */
export class AbsentSecretError extends HandledError {
  constructor(id: string) {
    super(
      "secret_absent",
      `The secret "${id}" is not set. Set it, or mark the handle optional at its declaration.`,
      { fault: "platform" },
    );
  }
}

/** The preflight's verdict: every unanswerable required handle, at once. */
export class SecretsPreflightError extends HandledError {
  constructor(readonly missing: readonly string[]) {
    super(
      "secrets_preflight_failed",
      `No adapter answers these required secrets:\n  ${missing.join("\n  ")}\n` +
        `Set each, or mark its handle optional at the declaration.`,
      { fault: "platform" },
    );
  }
}

/** A credential has one owner; a second declaration is a guess about intent. */
export class SecretClaimedTwiceError extends HandledError {
  constructor(
    readonly id: string,
    readonly owners: readonly string[],
  ) {
    super(
      "secret_claimed_twice",
      `The secret "${id}" is declared by both ${owners.join(" and ")}. ` +
        `One owner declares it and builds the collaborator; inject that into the other.`,
      { fault: "platform" },
    );
  }
}

/** 1Password answered something other than "no such key". */
export class OnePasswordUnavailableError extends HandledError {
  constructor(detail: string) {
    super(
      "one_password_unavailable",
      `1Password could not be read: ${detail}. Run \`op signin\` and retry.`,
      { fault: "platform" },
    );
  }
}

/** A development convenience reached a production process — refused loudly. */
export class OnePasswordInProductionError extends HandledError {
  constructor() {
    super(
      "one_password_in_production",
      "1Password is a development convenience; production resolves secrets from the " +
        "environment. Unset LANGWATCH_OP_ACCOUNT on this deployment.",
      { fault: "platform" },
    );
  }
}
