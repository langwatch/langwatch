import {
  DatasetContentBackfillTask,
  DatasetObjectStorageResolverAdapter,
  DatasetObjectStorageS3ClientResolverAdapter,
  DatasetStorageDestinationService,
  type DatasetStorageDestination,
} from "@langwatch/dataset-server";
import { PrismaDatasetMigrationRepository } from "@langwatch/dataset-server/composition/dataset-migration";
import type { TasksObjectStorage } from "./infrastructure/tasks-stored-object-storage.adapter.ts";
import type { TasksHost } from "./tasks-host.composition.ts";

/**
 * Translates this process's own destination POLICY (BYOC first, then this deployment's
 * backend) into the simpler decision `DatasetObjectStorageResolverAdapter` needs.
 */
class TasksDatasetStorageDestination extends DatasetStorageDestinationService {
  constructor(private readonly policy: TasksObjectStorage["destination"]) {
    super();
  }

  async resolve(projectId: string): Promise<DatasetStorageDestination> {
    const destination = await this.policy.resolve(projectId);
    if (destination.kind === "file") return { kind: "file", root: destination.root };
    return { kind: destination.kind };
  }
}

/**
 * Builds the `dataset-content-backfill` task, deferred to `run()` — resolving the real
 * `storage` reaches `TasksHost.objectStorage`, and a misconfigured environment should fail only
 * THIS task at run time, not every task at catalogue construction.
 */
export function buildDatasetContentBackfillTask({
  host,
}: {
  host: TasksHost;
}): DatasetContentBackfillTask {
  return DatasetContentBackfillTask.create({
    skipped: process.env.SKIP_DATASET_S3_MIGRATE === "true",
    dryRun: process.env.DATASET_S3_MIGRATE_DRY_RUN === "true",
    migration: () => {
      const objectStorage = host.requireObjectStorage();
      const storage = DatasetObjectStorageResolverAdapter.create({
        destination: new TasksDatasetStorageDestination(objectStorage.destination),
        s3ClientResolver: DatasetObjectStorageS3ClientResolverAdapter.create({
          aws: objectStorage.aws,
          lookupProjectTarget: (projectId) => objectStorage.projects.tryGet(projectId),
          globalS3: objectStorage.globalS3,
        }),
      });
      // The process holds the typed Prisma client, so it builds the migration
      // repository directly, the way `object-storage-migrate.composition.ts`
      // builds its ClickHouse one.
      return PrismaDatasetMigrationRepository.create({ database: host.requirePrisma(), storage });
    },
  });
}
