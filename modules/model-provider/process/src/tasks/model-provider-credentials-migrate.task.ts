import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import { ModelProviderLegacyMigrationService } from "#services/model-provider-legacy-migration.service";

import type {
  ModelProviderMigrationDatabase,
  ModelProviderMigrationOutcome,
} from "../rules/model-provider-migration.rules.ts";

const logger = createLogger("langwatch:task:model-provider-migrate-credentials");

/**
 * Encrypts every `customKeys` value still written in plaintext.
 */
export async function runModelProviderKeysMigration({
  database,
}: {
  database: ModelProviderMigrationDatabase;
}): Promise<ModelProviderMigrationOutcome> {
  const migrations = ModelProviderLegacyMigrationService.create();
  const rows = await database.findProjectScopedLegacyColumns();
  logger.info({ providers: rows.length }, "Starting model provider key encryption migration");

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const seal = migrations.planModelProviderKeysSeal({ row });
    if (seal.outcome === "unchanged") {
      skipped += 1;
      continue;
    }

    await database.updateLegacyColumns({ id: row.id, customKeys: seal.keys });
    updated += 1;
  }

  // The counts, never the values: a log line naming one would publish the
  // credential this migration exists to stop storing in the clear.
  logger.info({ updated, skipped }, "Model provider key encryption migration complete");
  return { updated, skipped };
}

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * model-provider-migrate-credentials`.
 */
export class ModelProviderCredentialsMigrateTask extends Task {
  readonly name = "model-provider-migrate-credentials";
  readonly description = "Encrypts every ModelProvider customKeys value still stored in plaintext.";

  private constructor(private readonly database: () => ModelProviderMigrationDatabase) {
    super();
  }

  static create({
    database,
  }: {
    /** The provider store, which seals each plaintext row with the deployment's cipher. */
    database: () => ModelProviderMigrationDatabase;
  }): ModelProviderCredentialsMigrateTask {
    return new ModelProviderCredentialsMigrateTask(database);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    await runModelProviderKeysMigration({ database: this.database() });
  }
}
