import {
  GovernanceEncryptionPort,
  IngestionCredentialsService,
} from "@langwatch/enterprise-governance-server";
import { decrypt, encrypt } from "~/utils/encryption";

class AppGovernanceEncryptionPort extends GovernanceEncryptionPort {
  encrypt(value: string): string {
    return encrypt(value);
  }

  decrypt(value: string): string {
    return decrypt(value);
  }
}

export class AppIngestionCredentialsService {
  private constructor(private readonly service: IngestionCredentialsService) {}

  static create(): AppIngestionCredentialsService {
    return new AppIngestionCredentialsService(
      IngestionCredentialsService.create(new AppGovernanceEncryptionPort()),
    );
  }

  isEncrypted(value: unknown): value is string {
    return this.service.isEncrypted(value);
  }

  encryptParserConfig(
    parserConfig: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> | null | undefined {
    return this.service.encryptParserConfig(parserConfig);
  }

  decrypt(raw: unknown): Record<string, string> {
    return this.service.decrypt(raw);
  }
}
