import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import { PostgresDatasetMigrationAdapter } from "#adapters/postgres.dataset-migration.adapter";

const logger = createLogger("langwatch:tasks:backfill-dataset-content-to-object-storage");

/**
 * Moves dataset content out of Postgres and into object storage.
 */
export class DatasetContentBackfillSweep {
  private constructor(private readonly migration: DatasetContentMigration) {}

  /** The migration is the whole collaborator, so a fake is one method. */
  static withMigration(migration: DatasetContentMigration): DatasetContentBackfillSweep {
    return new DatasetContentBackfillSweep(migration);
  }

  async execute({ skipped, dryRun }: { skipped: boolean; dryRun: boolean }): Promise<void> {
    if (skipped) {
      logger.info("SKIP_DATASET_S3_MIGRATE is set — skipping the dataset content backfill");
      return;
    }

    const result = await this.migration.run({ dryRun });
    if (result.status === "schema-pending") {
      logger.info("Dataset chunk-layout columns are pending — skipping this migration run");
      return;
    }

    logger.info(
      { ...result.summary, dryRun },
      dryRun
        ? "Finished the dataset content backfill dry run"
        : "Finished the dataset content backfill",
    );
  }
}

type DatasetBackfillOutcome = Awaited<
  ReturnType<ReturnType<typeof PostgresDatasetMigrationAdapter.create>["run"]>
>;

/** What the sweep needs of the Postgres migration adapter, and nothing more. */
export type DatasetContentMigration = {
  run(input: { dryRun: boolean }): Promise<DatasetBackfillOutcome>;
};

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task dataset-content-backfill`.
 * Registered in `apps/tasks`' catalogue via `dataset-content-backfill.composition.ts`, which
 * builds a `DatasetStorageResolver` from `TasksHost.objectStorage`.
 */
export class DatasetContentBackfillTask extends Task {
  readonly name = "dataset-content-backfill";
  readonly description = "Moves dataset content out of Postgres and into object storage.";

  private constructor(
    private readonly migration: () => DatasetContentMigration,
    private readonly skipped: boolean,
    private readonly dryRun: boolean,
  ) {
    super();
  }

  static create({
    migration,
    skipped = false,
    dryRun = false,
  }: {
    migration: () => DatasetContentMigration;
    /** Leave the content where it is. Stated by the task launcher. */
    skipped?: boolean;
    /** Report what would move without moving it. Stated by the task launcher. */
    dryRun?: boolean;
  }): DatasetContentBackfillTask {
    return new DatasetContentBackfillTask(migration, skipped, dryRun);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const sweep = DatasetContentBackfillSweep.withMigration(this.migration());
    await sweep.execute({ skipped: this.skipped, dryRun: this.dryRun });
  }
}
