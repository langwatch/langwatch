import { HandledError } from "@langwatch/handled-error";

/** Every refusal at once, each naming owner.path ← ENV_VAR. */
export class ConfigParseError extends HandledError {
  constructor(readonly refusals: readonly string[]) {
    super("config_refused", `Configuration refused:\n  ${refusals.join("\n  ")}`, {
      fault: "platform",
    });
  }
}

/** Two owners bound one env var through two different leaves — two meanings. */
export class ConfigCollisionError extends HandledError {
  constructor(env: string, owners: readonly string[]) {
    super(
      "config_collision",
      `"${env}" is declared by ${owners.map((o) => `"${o}"`).join(" and ")}. One env var has ` +
        `one owner: let the owner that declares it pass the parsed value down, or rename one.`,
      { fault: "platform" },
    );
  }
}

/** The wall between the packages: a config leaf claimed a declared secret. */
export class ConfigClaimsSecretError extends HandledError {
  constructor(env: string, configOwner: string, secretOwner: string) {
    super(
      "config_claims_secret",
      `"${configOwner}" declares "${env}" as config, but "${secretOwner}" declares it as a ` +
        `secret. Secrets never ride config: resolve through the chain, inject the collaborator.`,
      { fault: "platform" },
    );
  }
}
