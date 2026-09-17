import { SecretSource } from "./secret-source.port.ts";

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
