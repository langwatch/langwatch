import { PostgresDatasetMigrationAdapter } from "@langwatch/dataset-server";
import { createLogger } from "@langwatch/observability";
import { AppDatasetStorageResolver } from "../runtime/app/features/dataset-storage";
import { AppAwsClientConfiguration } from "../runtime/app/aws-client.composition";
import { prisma } from "../server/db";
import { parseOutboundProxyConfig } from "../server/outboundProxy";

const logger = createLogger("langwatch:tasks:backfillDatasetContentToS3");

const createMigration = (storage: AppDatasetStorageResolver) =>
  PostgresDatasetMigrationAdapter.create({
    database: prisma,
    storage,
  });

function createTaskStorage(): { storage: AppDatasetStorageResolver; close(): Promise<void> } {
  const aws = AppAwsClientConfiguration.create(parseOutboundProxyConfig(process.env));
  const storage = new AppDatasetStorageResolver({
    buildS3ClientConfig: (input) => aws.build(input),
  });
  return {
    storage,
    async close(): Promise<void> {
      await storage.close();
      await aws.close();
    },
  };
}

export const migrateDatasetContentToObjectStorage = async (input: {
  datasetId: string;
  projectId: string;
}) => {
  const taskStorage = createTaskStorage();
  try {
    return await createMigration(taskStorage.storage).migrateDataset(input);
  } finally {
    await taskStorage.close();
  }
};

/** Process entrypoint for the package-owned Dataset storage migration. */
export default async function execute(): Promise<void> {
  if (process.env.SKIP_DATASET_S3_MIGRATE) {
    logger.info("SKIP_DATASET_S3_MIGRATE is set — skipping PG→S3 dataset backfill");
    return;
  }

  const dryRun =
    Boolean(process.env.DATASET_S3_MIGRATE_DRY_RUN) || process.argv.includes("--dry-run");
  const taskStorage = createTaskStorage();
  try {
    const result = await createMigration(taskStorage.storage).run({ dryRun });
    if (result.status === "schema-pending") {
      logger.info("Dataset chunk-layout columns are pending — skipping this migration run");
      return;
    }

    logger.info(
      { ...result.summary, dryRun },
      dryRun
        ? "Finished PG→S3 dataset content backfill dry run"
        : "Finished PG→S3 dataset content backfill",
    );
  } finally {
    await taskStorage.close();
  }
}
