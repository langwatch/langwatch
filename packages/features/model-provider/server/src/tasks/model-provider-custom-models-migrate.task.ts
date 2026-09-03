import { getProviderModelOptions, type CustomModelEntry } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import { migrateCustomModelsRow } from "#services/model-provider-legacy-migration.service";
import type {
  ModelProviderMigrationDatabase,
  ModelProviderMigrationOutcome,
} from "./model-provider-migration.shared";

const logger = createLogger("langwatch:task:model-provider-migrate-custom-models");

/**
 * Converts every legacy `string[]` custom-model column to `CustomModelEntry[]`.
 *
 * A row already in object form is skipped, so a re-run costs one read per row
 * and writes nothing. Scoped project by project rather than table-wide
 * because the client is the process's guarded one: a `ModelProvider` is
 * addressed through its scopes, and a query that named no tenant would be
 * refused by the tenancy guard rather than answered.
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
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * model-provider-migrate-custom-models`.
 *
 * `database` is a thunk for the same reason as `LwqlProvisionTask`'s: the
 * launcher builds the whole catalogue before it knows which task was asked
 * for, so resolving a possibly-absent handle is deferred to `run()`.
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
