import * as fs from "fs";
import * as path from "path";
import {
  DSPY_STEPS_INDEX,
  esClient,
  MIGRATION_INDEX,
  TRACE_INDEX,
} from "../server/elasticsearch";
import {
  dspyStepsMapping,
  elasticMigrations,
  traceMapping,
  type ElasticSearchMigration,
} from "../../elastic/schema";
import type { MappingProperty } from "@elastic/elasticsearch/lib/api/types";

const files = fs
  .readdirSync(path.join(__dirname, "..", "..", "elastic", "migrations"))
  .filter((file) => file.endsWith(".ts") && file !== "index.ts")
  .sort();

const migrations = Object.fromEntries(
  files.map((file) => {
    const name = path.basename(file, ".ts");
    return [
      name,
      require(path.join(__dirname, "..", "..", "elastic", "migrations", file)),
    ];
  })
);

export default async function execute() {
  const migrationsExists = await esClient.indices.exists({
    index: MIGRATION_INDEX,
  });
  if (!migrationsExists) {
    const lastMigration = Object.keys(migrations).pop();
    await createIndexes(lastMigration);
  }

  const migrationsToExecute = await getMigrationsToExecute();
  console.log('migrationsToExecute', migrationsToExecute);
  // for (const migration of migrationsToExecute) {
  //   const migrationId = migration.split("_")[0];
  //   try {
  //     await migrations[migration].migrate(migrationId);
  //     await esClient.index({
  //       index: MIGRATION_INDEX,
  //       body: { migration_name: migration, applied_at: Date.now() },
  //     });
  //   } catch (error) {
  //     console.error(`Failed to apply migration: ${migration}`, error);
  //   }
  // }
}

const getLastAppliedMigration = async () => {
  const allMigrations = await esClient.search<ElasticSearchMigration>({
    index: MIGRATION_INDEX,
    body: {
      size: 10_000,
    },
  });

  const migrations = allMigrations.hits.hits.map(
    (hit) => hit._source.migration_name
  );

  return migrations.sort().pop();
};

const getMigrationsToExecute = async () => {
  const lastMigration = await getLastAppliedMigration();
  return Object.keys(migrations).filter(
    (migration) => migration > lastMigration
  );
};

const createIndexes = async (lastMigration: string) => {
  const traceExists = await esClient.indices.exists({ index: TRACE_INDEX.base });
  if (!traceExists) {
    await esClient.indices.create({
      index: TRACE_INDEX.base,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
      },
      mappings: { properties: traceMapping as Record<string, MappingProperty> },
    });
  }
  await esClient.indices.putMapping({
    index: TRACE_INDEX.base,
    properties: traceMapping as Record<string, MappingProperty>,
  });
  await esClient.indices.putAlias({
    index: TRACE_INDEX.base,
    name: TRACE_INDEX.alias,
  });

  const dspyStepExists = await esClient.indices.exists({
    index: DSPY_STEPS_INDEX.base,
  });
  if (!dspyStepExists) {
    await esClient.indices.create({
      index: DSPY_STEPS_INDEX.base,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
      },
      mappings: {
        properties: dspyStepsMapping as Record<string, MappingProperty>,
      },
    });
  }
  await esClient.indices.putAlias({
    index: DSPY_STEPS_INDEX.base,
    name: DSPY_STEPS_INDEX.alias,
  });

  const migrationsExists = await esClient.indices.exists({
    index: MIGRATION_INDEX,
  });
  if (!migrationsExists) {
    await esClient.indices.create({
      index: MIGRATION_INDEX,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
      },
      mappings: {
        properties: elasticMigrations as Record<string, MappingProperty>,
      },
    });

    await esClient.index({
      index: MIGRATION_INDEX,
      body: { migration_name: lastMigration, applied_at: Date.now() },
    });
  }
  await esClient.indices.putMapping({
    index: MIGRATION_INDEX,
    properties: elasticMigrations as Record<string, MappingProperty>,
  });
};
