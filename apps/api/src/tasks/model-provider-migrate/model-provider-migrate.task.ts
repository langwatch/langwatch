import {
  getProviderModelOptions,
  type CustomModelEntry,
} from "@langwatch/model-provider-contract";
import {
  migrateCustomModelsRow,
  migrateModelProviderKeysRow,
  type ModelProviderCredentialCipherPort,
} from "@langwatch/model-provider-server";
import { createLogger } from "@langwatch/observability";

/**
 * The two one-off ModelProvider data migrations, as a walk over the table.
 *
 * Both are idempotent and both are decided a row at a time by
 * `@langwatch/model-provider-server` — this file only supplies the walk: which
 * projects, which client, and the deployment's own cipher. Splitting it that
 * way is what lets the conversions be tested without a database, and it is why
 * neither function here decides anything about a row.
 *
 * The read is scoped project by project rather than table-wide because the
 * client is the process's guarded one: a `ModelProvider` is addressed through
 * its scopes, and a query that named no tenant would be refused by the
 * tenancy guard rather than answered.
 */

const logger = createLogger("langwatch:task:model-provider-migrate");

/** Exactly the operations these migrations perform, and nothing else. */
export type ModelProviderMigrationDatabase = {
  project: { findMany(args: { select: { id: true } }): Promise<{ id: string }[]> };
  modelProvider: {
    findMany(args: {
      where: { scopes: { some: { scopeType: "PROJECT"; scopeId: string } } };
      select: Record<string, true>;
    }): Promise<Record<string, unknown>[]>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
};

/** What one migration did, so the caller can report it and a deploy can read it. */
export type ModelProviderMigrationOutcome = {
  updated: number;
  skipped: number;
};

/**
 * Converts every legacy `string[]` custom-model column to `CustomModelEntry[]`.
 *
 * A row already in object form is skipped, so a re-run costs one read per row
 * and writes nothing.
 */
export async function runCustomModelsMigration({
  database,
  registryLookup = getProviderModelOptions,
}: {
  database: ModelProviderMigrationDatabase;
  registryLookup?: typeof getProviderModelOptions;
}): Promise<ModelProviderMigrationOutcome> {
  const projects = await database.project.findMany({ select: { id: true } });
  logger.info({ projects: projects.length }, "Starting custom models migration");

  let updated = 0;
  let skipped = 0;

  for (const project of projects) {
    const rows = await database.modelProvider.findMany({
      where: { scopes: { some: { scopeType: "PROJECT", scopeId: project.id } } },
      select: { id: true, provider: true, customModels: true, customEmbeddingsModels: true },
    });

    for (const row of rows) {
      const result = migrateCustomModelsRow({
        row: row as {
          id: string;
          provider: string;
          customModels: unknown;
          customEmbeddingsModels: unknown;
        },
        registryLookup,
      });
      if (result === null) {
        skipped += 1;
        continue;
      }

      const data = updateDataFor(result);
      if (Object.keys(data).length === 0) {
        skipped += 1;
        continue;
      }

      await database.modelProvider.update({ where: { id: String(row.id) }, data });
      updated += 1;
    }
  }

  logger.info({ updated, skipped }, "Custom models migration complete");
  return { updated, skipped };
}

/** Only the columns the conversion actually changed reach the update. */
function updateDataFor(result: {
  customModels: CustomModelEntry[] | null;
  customEmbeddingsModels: CustomModelEntry[] | null;
}): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (result.customModels !== null) data.customModels = result.customModels;
  if (result.customEmbeddingsModels !== null) {
    data.customEmbeddingsModels = result.customEmbeddingsModels;
  }
  return data;
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
