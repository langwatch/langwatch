import { createLogger } from "@langwatch/observability";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";
import { Task } from "@langwatch/task";
import { ModelProviderCredentialCipherPort } from "#ports/model-provider.port";
import { migrateModelProviderKeysRow } from "#services/model-provider-legacy-migration.service";
import type {
  ModelProviderMigrationDatabase,
  ModelProviderMigrationOutcome,
} from "./model-provider-migration.shared";

const logger = createLogger("langwatch:task:model-provider-migrate-credentials");

/** The deployment's stored-secret cipher, as the ModelProvider rows want it. */
class AesGcmModelProviderCredentialCipher extends ModelProviderCredentialCipherPort {
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

/**
 * Builds the cipher from the deployment's `CREDENTIALS_SECRET`, or throws —
 * the credential migration writes ciphertext every other process has to
 * read, so a deployment with no key configured must not run it.
 */
export function modelProviderCredentialCipherFromEnv({
  key,
}: {
  key: string | undefined;
}): ModelProviderCredentialCipherPort {
  const trimmed = key?.trim();
  if (!trimmed) {
    throw new Error(
      "The credential migration writes ciphertext every other process has to read: set CREDENTIALS_SECRET.",
    );
  }
  return new AesGcmModelProviderCredentialCipher(
    AesGcmSecretEncryptionAdapter.create({ key: trimmed }),
  );
}

/**
 * Encrypts every `customKeys` value still written in plaintext.
 *
 * The cipher is the deployment's, handed in: the ciphertext is a wire format
 * read by every other process, so a second implementation of it would write
 * rows that nothing can decrypt.
 */
export async function runModelProviderKeysMigration({
  database,
  cipher,
}: {
  database: ModelProviderMigrationDatabase;
  cipher: ModelProviderCredentialCipherPort;
}): Promise<ModelProviderMigrationOutcome> {
  const projects = await database.project.findMany({ select: { id: true } });
  logger.info({ projects: projects.length }, "Starting model provider key encryption migration");

  let updated = 0;
  let skipped = 0;

  for (const project of projects) {
    const rows = await database.modelProvider.findMany({
      where: { scopes: { some: { scopeType: "PROJECT", scopeId: project.id } } },
      select: { id: true, customKeys: true },
    });

    for (const row of rows) {
      const encrypted = migrateModelProviderKeysRow({
        row: row as { id: string; customKeys: unknown },
        cipher,
      });
      if (encrypted === null) {
        skipped += 1;
        continue;
      }

      await database.modelProvider.update({
        where: { id: String(row.id) },
        data: { customKeys: encrypted },
      });
      updated += 1;
    }
  }

  // The counts, never the values: a log line naming one would publish the
  // credential this migration exists to stop storing in the clear.
  logger.info({ updated, skipped }, "Model provider key encryption migration complete");
  return { updated, skipped };
}

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * model-provider-migrate-credentials`.
 *
 * `database` and `cipher` are thunks for the same reason as
 * `LwqlProvisionTask`'s: the launcher builds the whole catalogue before it
 * knows which task was asked for, so resolving a possibly-absent handle is
 * deferred to `run()`.
 */
export class ModelProviderCredentialsMigrateTask extends Task {
  readonly name = "model-provider-migrate-credentials";
  readonly description = "Encrypts every ModelProvider customKeys value still stored in plaintext.";

  private constructor(
    private readonly database: () => ModelProviderMigrationDatabase,
    private readonly cipher: () => ModelProviderCredentialCipherPort,
  ) {
    super();
  }

  static create({
    database,
    cipher,
  }: {
    database: () => ModelProviderMigrationDatabase;
    cipher: () => ModelProviderCredentialCipherPort;
  }): ModelProviderCredentialsMigrateTask {
    return new ModelProviderCredentialsMigrateTask(database, cipher);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    await runModelProviderKeysMigration({ database: this.database(), cipher: this.cipher() });
  }
}
