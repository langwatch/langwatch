import type { GovernanceEncryptionPort } from "../ports/governance-encryption.port";

const ENCRYPTED_PREFIX = "enc:v1:";

export class IngestionCredentialsService {
  static create(
    encryption: GovernanceEncryptionPort,
  ): IngestionCredentialsService {
    return new IngestionCredentialsService(encryption);
  }

  constructor(private readonly encryption: GovernanceEncryptionPort) {}

  isEncrypted(value: unknown): value is string {
    return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
  }

  encryptParserConfig(
    parserConfig: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> | null | undefined {
    if (!parserConfig || typeof parserConfig !== "object") return parserConfig;
    const credentials = parserConfig.credentials;
    if (
      credentials === undefined ||
      credentials === null ||
      this.isEncrypted(credentials)
    ) {
      return parserConfig;
    }
    return {
      ...parserConfig,
      credentials:
        ENCRYPTED_PREFIX + this.encryption.encrypt(JSON.stringify(credentials)),
    };
  }

  decrypt(raw: unknown): Record<string, string> {
    if (this.isEncrypted(raw)) {
      const parsed: unknown = JSON.parse(
        this.encryption.decrypt(raw.slice(ENCRYPTED_PREFIX.length)),
      );
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, string>)
        : {};
    }
    return raw && typeof raw === "object"
      ? (raw as Record<string, string>)
      : {};
  }
}
