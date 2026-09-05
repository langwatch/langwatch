import { AwsClientProcessRuntime, OutboundProxyResolverPort } from "@langwatch/aws-client";
import {
  auditQueuesForCutover,
  PostgresObjectStorageMigrationInventoryAdapter,
  createMigrationTask,
  MigrationS3StorageDriverAdapter,
  ObjectStorageMigrateTask,
  parseMigrationTaskConfig,
  StoredObjectsClickHousePort,
  ClickHouseStoredObjectsRepository,
  type StoredObjectsClickHouseClient,
} from "@langwatch/stored-object-server";
import type { TasksHost } from "./tasks-host.composition";

/**
 * This process has no per-project ClickHouse routing — a single `CLICKHOUSE_URL` answers every
 * project, the same simplification `ClickHouseMigrateTask` and `LwqlProvisionTask` make.
 */
class TasksStoredObjectsClickHouse extends StoredObjectsClickHousePort {
  constructor(private readonly client: () => unknown) {
    super();
  }

  async resolveClient(_projectId: string): Promise<StoredObjectsClickHouseClient> {
    return this.client() as StoredObjectsClickHouseClient;
  }
}

/**
 * No outbound proxy for this process's object storage migration. `apps/tasks` has no proxy
 * configuration of its own yet, matching the API's and worker's mail/object-storage
 * compositions.
 */
class TasksNoOutboundProxy extends OutboundProxyResolverPort {
  tryResolveForHost(): string | undefined {
    return undefined;
  }
}

/**
 * Builds the `object-storage-migrate` task, deferred to `run()`. The BYOC exclusion
 * (`privateOrganizations`) is empty here: this process composes no route map of
 * privately-hosted organizations, so every project this task sees is treated as eligible.
 */
export function buildObjectStorageMigrateTask({
  host,
}: {
  host: TasksHost;
}): ObjectStorageMigrateTask {
  return ObjectStorageMigrateTask.create({
    migration: () => {
      const config = parseMigrationTaskConfig(process.env);
      const clickhouse = new TasksStoredObjectsClickHouse(() => host.requireClickhouse());
      const repository = ClickHouseStoredObjectsRepository.create(clickhouse);
      const aws = AwsClientProcessRuntime.create({ outboundProxy: new TasksNoOutboundProxy() });

      return createMigrationTask({
        config,
        inventory: PostgresObjectStorageMigrationInventoryAdapter.create({
          repository,
          prisma: host.requirePrisma(),
          privateOrganizations: new Map(),
        }),
        publishStoredObject: (row) => repository.insert({ projectId: row.project_id, row }),
        auditQueues: () => auditQueuesForCutover({ url: host.config.redisUrl }),
        s3Driver: MigrationS3StorageDriverAdapter.create({ aws, config: config.s3 }),
      });
    },
  });
}
