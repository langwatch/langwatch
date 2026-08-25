import { createHash, randomBytes } from "node:crypto";

export class IngestionSecretConfiguration {
  private constructor(readonly pepper: string) {}

  static create(input: {
    pepper?: string | null;
  }): IngestionSecretConfiguration {
    return new IngestionSecretConfiguration(input.pepper ?? "");
  }
}

export class IngestionSecretService {
  private constructor(
    private readonly configuration: IngestionSecretConfiguration,
    private readonly random: (size: number) => Uint8Array,
  ) {}

  static create(
    configuration: IngestionSecretConfiguration,
    options: { random?: (size: number) => Uint8Array } = {},
  ): IngestionSecretService {
    return new IngestionSecretService(
      configuration,
      options.random ?? ((size) => randomBytes(size)),
    );
  }

  generate(): string {
    return `lw_is_${Buffer.from(this.random(32)).toString("base64url")}`;
  }

  hash(rawSecret: string): string {
    return createHash("sha256")
      .update(`${this.configuration.pepper}::${rawSecret}`)
      .digest("base64url");
  }
}
