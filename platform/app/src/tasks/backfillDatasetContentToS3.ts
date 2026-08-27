import { PostgresDatasetMigrationAdapter } from "@langwatch/dataset-server";
import { createLogger } from "@langwatch/observability";
import { AppDatasetStorageResolver } from "../runtime/app/features/dataset-storage";
import { prisma } from "../server/db";

const logger = createLogger("langwatch:tasks:backfillDatasetContentToS3");

const createMigration = () =>
  PostgresDatasetMigrationAdapter.create({
    database: prisma,
    storage: new AppDatasetStorageResolver(),
  });

export const migrateDatasetContentToObjectStorage = (input: {
  datasetId: string;
  projectId: string;
}) => createMigration().migrateDataset(input);

/** Process entrypoint for the package-owned Dataset storage migration. */
export default async function execute(): Promise<void> {
  if (process.env.SKIP_DATASET_S3_MIGRATE) {
    logger.info("SKIP_DATASET_S3_MIGRATE is set — skipping PG→S3 dataset backfill");
    return;
  }

  const dryRun =
    Boolean(process.env.DATASET_S3_MIGRATE_DRY_RUN) || process.argv.includes("--dry-run");
  const migration = createMigration();

  const result = await migration.run({ dryRun });
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
}
