import process from "node:process";
import { ModelProviderCredentialCipherPort } from "@langwatch/model-provider-server";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";

import {
  runCustomModelsMigration,
  runModelProviderKeysMigration,
  type ModelProviderMigrationDatabase,
} from "./model-provider-migrate.task";

/**
 * The runnable ModelProvider data migrations —
 * `pnpm --filter @langwatch/platform-api task:model-provider-migrate <name>`.
 *
 * Two one-off conversions rather than one, because they are independent: the
 * custom-model reshape needs no key, and the credential encryption cannot run
 * at all without one. Naming which to run keeps a deployment that has not set
 * `CREDENTIALS_SECRET` from being blocked on a migration it does not need.
 *
 * The exit status is the contract: an operator runs this by hand and a
 * non-zero status must be visible.
 */

const MIGRATIONS = ["custom-models", "credentials"] as const;
type MigrationName = (typeof MIGRATIONS)[number];

const logger = createLogger("langwatch:task:model-provider-migrate");

/** The deployment's stored-secret cipher, as the ModelProvider rows want it. */
class TaskCredentialCipher extends ModelProviderCredentialCipherPort {
  constructor(private readonly encryption: AesGcmSecretEncryptionAdapter) {
    super();
  }

  encrypt(value: string): string {
    return this.encryption.encrypt(value);
  }

  decrypt(value: string): string {
    return this.encryption.decrypt(value);
  }
}

function requestedMigration(argv: readonly string[]): MigrationName {
  const requested = argv[2];
  if (requested === "custom-models" || requested === "credentials") return requested;
  throw new Error(
    `Name the migration to run, one of: ${MIGRATIONS.join(", ")}. Received ${JSON.stringify(requested ?? null)}.`,
  );
}

function connect(env: NodeJS.ProcessEnv): ModelProviderMigrationDatabase {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("The ModelProvider migrations need a database: set DATABASE_URL.");
  }
  return PrismaConnectionService.create({ guard: PrismaTenancyGuardService.create() }).connect(
    PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
  ).client as unknown as ModelProviderMigrationDatabase;
}

async function main(env: NodeJS.ProcessEnv, argv: readonly string[]): Promise<void> {
  const migration = requestedMigration(argv);
  const database = connect(env);

  if (migration === "custom-models") {
    await runCustomModelsMigration({ database });
    return;
  }

  const key = env.CREDENTIALS_SECRET?.trim();
  if (!key) {
    throw new Error(
      "The credential migration writes ciphertext every other process has to read: set CREDENTIALS_SECRET.",
    );
  }
  await runModelProviderKeysMigration({
    database,
    cipher: new TaskCredentialCipher(AesGcmSecretEncryptionAdapter.create({ key })),
  });
}

void main(process.env, process.argv).catch((error: unknown) => {
  logger.error({ error }, "ModelProvider migration failed");
  process.exitCode = 1;
});
