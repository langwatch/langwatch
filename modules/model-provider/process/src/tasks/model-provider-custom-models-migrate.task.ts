import { getProviderModelOptions } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import { ModelProviderLegacyMigrationService } from "#services/model-provider-legacy-migration.service";

import type {
  ModelProviderMigrationDatabase,
  ModelProviderMigrationOutcome,
} from "../rules/model-provider-migration.rules.ts";

const logger = createLogger("langwatch:task:model-provider-migrate-custom-models");

/**
 * Converts every legacy `string[]` custom-model column to
 * `CustomModelEntry[]`.
 */
export async function runCustomModelsMigration({
  database,
  registryLookup = getProviderModelOptions,
}: {
  database: ModelProviderMigrationDatabase;
  registryLookup?: typeof getProviderModelOptions;
}): Promise<ModelProviderMigrationOutcome> {
  const migrations = ModelProviderLegacyMigrationService.create();
  const rows = await database.findProjectScopedLegacyColumns();
  logger.info({ providers: rows.length }, "Starting custom models migration");

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const result = migrations.convertCustomModelsRow({ row, registryLookup });
    if (result === null) {
      skipped += 1;
      continue;
    }

    if (result.customModels === null && result.customEmbeddingsModels === null) {
      skipped += 1;
      continue;
    }

    await database.updateLegacyColumns({
      id: row.id,
      ...(result.customModels === null ? {} : { customModels: result.customModels }),
      ...(result.customEmbeddingsModels === null
        ? {}
        : { customEmbeddingsModels: result.customEmbeddingsModels }),
    });
    updated += 1;
  }

  logger.info({ updated, skipped }, "Custom models migration complete");
  return { updated, skipped };
}

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * model-provider-migrate-custom-models`.
 */
export class ModelProviderCustomModelsMigrateTask extends Task {
  readonly name = "model-provider-migrate-custom-models";
  readonly description =
    "Converts every legacy string[] custom-model column to CustomModelEntry[].";

  private constructor(private readonly database: () => ModelProviderMigrationDatabase) {
    super();
  }

  static create({
    database,
  }: {
    database: () => ModelProviderMigrationDatabase;
  }): ModelProviderCustomModelsMigrateTask {
    return new ModelProviderCustomModelsMigrateTask(database);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    await runCustomModelsMigration({ database: this.database() });
  }
}
