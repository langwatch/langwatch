import type { SecretService } from "@langwatch/secret-contract";
import { PostgresSecretAdapter, SecretEncryptionPort } from "@langwatch/secret-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { RESERVED_PROJECT_SECRET_NAMES } from "~/server/projects/reserved-secret-names";
import { decrypt, encrypt } from "~/utils/encryption";

export { SecretPublicApi as AppSecretApi } from "@langwatch/secret-server";

class AppSecretEncryptionPort extends SecretEncryptionPort {
  encrypt(value: string): string {
    return encrypt(value);
  }

  decrypt(value: string): string {
    return decrypt(value);
  }
}

export class AppSecretRuntime {
  private constructor() {}

  static create(options: { database: PrismaClient }): SecretService {
    return PostgresSecretAdapter.create({
      database: options.database,
      encryption: new AppSecretEncryptionPort(),
      reservedNames: RESERVED_PROJECT_SECRET_NAMES,
    }).build();
  }
}
