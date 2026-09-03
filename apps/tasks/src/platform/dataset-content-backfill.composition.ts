import {
  DatasetContentBackfillTask,
  DatasetObjectStorageResolver,
  DatasetObjectStorageS3ClientResolver,
  DatasetStorageDestinationPort,
  type DatasetStorageDestination,
} from "@langwatch/dataset-server";
import type { TasksObjectStorage } from "./infrastructure/tasks-stored-object-storage.adapter";
import type { TasksHost } from "./tasks-host.composition";

/**
 * Translates this process's own destination POLICY (BYOC first, then this
 * deployment's backend) into the simpler decision `DatasetObjectStorageResolver`
 * needs — bucket, endpoint and credentials stay resolved on Dataset's own
 * side (through its own `DatasetS3ClientResolver`), so only the backend KIND
 * crosses this seam.
 */
class TasksDatasetStorageDestination extends DatasetStorageDestinationPort {
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
 * Builds the `dataset-content-backfill` task, deferred to `run()` — resolving
 * the real `storage` reaches `TasksHost.objectStorage`, and a misconfigured
 * environment should fail only THIS task at run time, not every task at
 * catalogue construction.
 */
export function buildDatasetContentBackfillTask({
  host,
}: {
  host: TasksHost;
}): DatasetContentBackfillTask {
  return DatasetContentBackfillTask.create({
    database: () => host.requirePrisma(),
    storage: () => {
      const objectStorage = host.requireObjectStorage();
      return DatasetObjectStorageResolver.create({
        destination: new TasksDatasetStorageDestination(objectStorage.destination),
        s3ClientResolver: new DatasetObjectStorageS3ClientResolver(
          objectStorage.aws,
          (projectId) => objectStorage.projects.tryGet(projectId),
          objectStorage.globalS3,
        ),
      });
    },
  });
}
