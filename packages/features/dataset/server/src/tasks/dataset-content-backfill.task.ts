import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { Task } from "@langwatch/task";
import { PostgresDatasetMigrationAdapter } from "#adapters/postgres.dataset-migration.adapter";
import type { DatasetStorageResolver } from "#ports/dataset-storage.port";

const logger = createLogger("langwatch:tasks:backfill-dataset-content-to-object-storage");

/**
 * Moves dataset content out of Postgres and into object storage.
 *
 * The migration itself belongs to `@langwatch/dataset-server`; what lives here
 * is the sweep's own decisions — whether the operator asked to skip it, whether
 * this is a dry run, and what a pending schema means — so they can be exercised
 * without an S3 account.
 *
 * `SKIP_DATASET_S3_MIGRATE` and `DATASET_S3_MIGRATE_DRY_RUN` arrive as parsed
 * values rather than being read here: a task that reached for the environment
 * would be the one place in this process that did.
 *
 * The composed entrypoint is still absent, and the reason is named:
 * `DatasetStorageResolver` is built inside
 * `app/worker-dataset-normalization.composition.ts` from the process's stored
 * object runtime, its AWS runtime and its per-project S3 sources, and none of
 * that is reachable from outside that composition yet. The sweep takes the
 * resolver as a parameter, so a runner is a few lines the moment it is.
 */
export class DatasetContentBackfillSweep {
  private constructor(
    private readonly migration: {
      run(input: { dryRun: boolean }): Promise<DatasetBackfillOutcome>;
    },
  ) {}

  static create({
    database,
    storage,
  }: {
    database: PrismaClient;
    storage: DatasetStorageResolver;
  }): DatasetContentBackfillSweep {
    return new DatasetContentBackfillSweep(
      PostgresDatasetMigrationAdapter.create({ database, storage }),
    );
  }

  /** Test seam: the migration is the whole collaborator, so a fake is one method. */
  static withMigration(migration: {
    run(input: { dryRun: boolean }): Promise<DatasetBackfillOutcome>;
  }): DatasetContentBackfillSweep {
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

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * dataset-content-backfill`. Registered in `apps/tasks`' catalogue via
 * `dataset-content-backfill.composition.ts`, which builds a
 * `DatasetStorageResolver` from `TasksHost.objectStorage`.
 * `SKIP_DATASET_S3_MIGRATE` and `DATASET_S3_MIGRATE_DRY_RUN` are read here, at
 * the process boundary — `DatasetContentBackfillSweep.execute` above takes
 * them as parsed values so it stays testable without an environment.
 *
 * `database` and `storage` are FACTORIES, not values: resolving the real
 * `storage` needs `TasksHost.objectStorage`, and a missing/misconfigured
 * environment should fail only THIS task at run time, not every task at
 * catalogue construction.
 */
export class DatasetContentBackfillTask extends Task {
  readonly name = "dataset-content-backfill";
  readonly description = "Moves dataset content out of Postgres and into object storage.";

  private constructor(
    private readonly database: () => PrismaClient,
    private readonly storage: () => DatasetStorageResolver,
  ) {
    super();
  }

  static create({
    database,
    storage,
  }: {
    database: () => PrismaClient;
    storage: () => DatasetStorageResolver;
  }): DatasetContentBackfillTask {
    return new DatasetContentBackfillTask(database, storage);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const sweep = DatasetContentBackfillSweep.create({
      database: this.database(),
      storage: this.storage(),
    });
    await sweep.execute({
      skipped: process.env.SKIP_DATASET_S3_MIGRATE === "true",
      dryRun: process.env.DATASET_S3_MIGRATE_DRY_RUN === "true",
    });
  }
}
