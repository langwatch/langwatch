import { SecretSource } from "./secret-source.port.ts";

/**
 * The shell environment plus the `.env` the application already loads — by the
 * time a Node process runs, `--env-file-if-exists` has folded both into one
 * record, so this is a single read and the default source out of the box.
 *
 * An empty string counts as absent, matching how every other configuration
 * reader in the repository treats a stated-but-blank variable.
 */
export class EnvSecretSource extends SecretSource {
  static create({
    environment,
    name = "env",
  }: {
    environment: Readonly<Record<string, unknown>>;
    name?: string;
  }): EnvSecretSource {
    return new EnvSecretSource(environment, name);
  }

  private constructor(
    private readonly environment: Readonly<Record<string, unknown>>,
    readonly name: string,
  ) {
    super();
  }

  resolve({ keys }: { keys: readonly string[] }): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (const key of keys) {
      const value = this.environment[key];
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed !== "") found.set(key, trimmed);
    }

    return Promise.resolve(found);
  }
}
