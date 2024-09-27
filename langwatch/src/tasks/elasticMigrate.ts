import * as fs from "fs";
import * as path from "path";
import {
  BATCH_EVALUATION_INDEX,
  DSPY_STEPS_INDEX,
  esClient,
  MIGRATION_INDEX,
  TRACE_INDEX,
} from "../server/elasticsearch";
import {
  batchEvaluationMapping,
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
    if (!lastMigration) {
      throw new Error("No migrations found on elastic/migrations/ folder");
    }
    console.log(
      "\x1b[33m%s\x1b[0m",
      `Migration index not found, creating ${
        process.env.IS_OPENSEARCH ? "OpenSearch" : "Elasticsearch"
      } indexes from scratch`
    );
    await createIndexes(lastMigration);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  const migrationsToExecute = await getMigrationsToExecute();
  if (migrationsToExecute.length === 0) {
    console.log(
      "\x1b[32m%s\x1b[0m",
      `${
        process.env.IS_OPENSEARCH ? "OpenSearch" : "Elasticsearch"
      } is up to date, no migrations to execute`
    );
    return;
  }
  for (const migration of migrationsToExecute) {
    console.log("Executing migration", migration);
    const migrationKey = migration.split("_")[0];
    try {
      await migrations[migration].migrate(migrationKey);
      await esClient.index({
        index: MIGRATION_INDEX,
        body: { migration_name: migration, applied_at: Date.now() },
      });
    } catch (error) {
      console.error(`Failed to apply migration: ${migration}`, error);
      throw error;
    }
  }
}

const getLastAppliedMigration = async () => {
  const allMigrations = await esClient.search<ElasticSearchMigration>({
    index: MIGRATION_INDEX,
    body: {
      size: 10_000,
    },
  });

  const migrations = allMigrations.hits.hits
    .filter((hit) => hit._source)
    .map((hit) => hit._source!.migration_name);

  return migrations.sort().pop();
};

const getMigrationsToExecute = async () => {
  const lastMigration = (await getLastAppliedMigration()) ?? "0_";
  return Object.keys(migrations).filter(
    (migration) => migration > lastMigration
  );
};

const getLastIndexForBase = async (base: string) => {
  const allIndices = await esClient.cat.indices({ format: "json" });
  const indices = allIndices
    .filter((index) => index.index?.startsWith(base))
    .sort();

  return indices.pop();
};

const createIndexes = async (lastMigration: string) => {
  // Traces
  const traceExists = await getLastIndexForBase(TRACE_INDEX.base);
  if (!traceExists) {
    const settings: any = {
      number_of_shards: 1,
      number_of_replicas: 0,
    };

    if (process.env.IS_OPENSEARCH === "true") {
      settings.index = {
        knn: true,
      };
    }

    await esClient.indices.create({
      index: TRACE_INDEX.base,
      settings: settings,
      mappings: { properties: traceMapping as Record<string, MappingProperty> },
    });
  }
  await esClient.indices.putMapping({
    index: traceExists?.index ?? TRACE_INDEX.base,
    properties: traceMapping as Record<string, MappingProperty>,
  });
  await esClient.indices.putAlias({
    index: traceExists?.index ?? TRACE_INDEX.base,
    name: TRACE_INDEX.alias,
    is_write_index: true,
  });

  // DSPy Steps
  const dspyStepExists = await getLastIndexForBase(DSPY_STEPS_INDEX.base);
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
  await esClient.indices.putMapping({
    index: dspyStepExists?.index ?? DSPY_STEPS_INDEX.base,
    properties: dspyStepsMapping as Record<string, MappingProperty>,
  });
  await esClient.indices.putAlias({
    index: dspyStepExists?.index ?? DSPY_STEPS_INDEX.base,
    name: DSPY_STEPS_INDEX.alias,
    is_write_index: true,
  });

  // Batch Evaluations
  const batchEvaluationExists = await getLastIndexForBase(
    BATCH_EVALUATION_INDEX.base
  );
  if (!batchEvaluationExists) {
    await esClient.indices.create({
      index: BATCH_EVALUATION_INDEX.base,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
      },
      mappings: {
        properties: batchEvaluationMapping as Record<string, MappingProperty>,
      },
    });
  }
  await esClient.indices.putMapping({
    index: batchEvaluationExists?.index ?? BATCH_EVALUATION_INDEX.base,
    properties: batchEvaluationMapping as Record<string, MappingProperty>,
  });
  await esClient.indices.putAlias({
    index: batchEvaluationExists?.index ?? BATCH_EVALUATION_INDEX.base,
    name: BATCH_EVALUATION_INDEX.alias,
    is_write_index: true,
  });

  // Migrations
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
