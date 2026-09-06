import { SecretSource } from "./secret-source.port.ts";

/**
 * Boot stopped because a secret nothing upstream could answer for is required
 * here. Carries every missing key name and the sources that were tried, and
 * no candidate value — nothing on this error is sensitive.
 */
export class MissingSecretsError extends Error {
  constructor(
    readonly keys: readonly string[],
    readonly triedSources: readonly string[],
  ) {
    super(
      `No source could resolve ${keys.join(", ")}. Tried: ${triedSources.join(" -> ")}. ` +
        "Set the variable in your environment or in the workspace-root .env, " +
        "or point LANGWATCH_SECRETS_VAULT at the 1Password vault that holds it.",
    );
    this.name = "MissingSecretsError";
  }
}

/**
 * The tail of the chain. It resolves nothing; it refuses, by name, for the
 * keys a deployment declared it cannot start without.
 *
 * Keys outside `required` fall through silently, which is what keeps the seam
 * behaviourally identical to reading `process.env` directly: an absent
 * optional provider key stays absent rather than becoming a boot failure.
 */
export class RefusingSecretSource extends SecretSource {
  static create({
    required,
    triedSources = [],
    name = "refuse",
  }: {
    required: readonly string[];
    triedSources?: readonly string[];
    name?: string;
  }): RefusingSecretSource {
    return new RefusingSecretSource(required, triedSources, name);
  }

  private constructor(
    private readonly required: readonly string[],
    private readonly triedSources: readonly string[],
    readonly name: string,
  ) {
    super();
  }

  resolve({ keys }: { keys: readonly string[] }): Promise<Map<string, string>> {
    const missing = keys.filter((key) => this.required.includes(key));
    if (missing.length > 0) {
      return Promise.reject(new MissingSecretsError(missing, this.triedSources));
    }

    return Promise.resolve(new Map<string, string>());
  }
}
