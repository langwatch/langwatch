import { AwsClientProcessRuntime, OutboundProxyResolver } from "@langwatch/aws-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  auditQueuesForCutover,
  createMigrationTask,
  MigrationBlobS3Repository,
  ObjectStorageMigrateTask,
  ObjectStorageMigrationInventory,
  parseMigrationTaskConfig,
  StoredObjectsClickHouse,
  type MigrationDataset,
  type MigrationPageRequest,
  type MigrationProject,
  type StoredObject,
  type StoredObjectsClickHouseClient,
} from "@langwatch/stored-object-server";
import { ClickHouseStoredObjectsRepository } from "@langwatch/stored-object-server/composition/stored-objects";
import type { TasksHost } from "./tasks-host.composition.ts";

/**
 * This process has no per-project ClickHouse routing — a single `CLICKHOUSE_URL` answers every
 * project, the same simplification `ClickHouseMigrateTask` and `LwqlProvisionTask` make.
 */
class TasksStoredObjectsClickHouse extends StoredObjectsClickHouse {
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
class TasksNoOutboundProxy extends OutboundProxyResolver {
  tryResolveForHost(): string | undefined {
    return undefined;
  }
}

/**
 * The three pages a migration walks. The project and dataset rows belong to other
 * features, so the process holding those clients reads them and hands the port over;
 * the stored-object page comes from the ClickHouse repository built beside it.
 */
class TasksObjectStorageMigrationInventory extends ObjectStorageMigrationInventory {
  private readonly repository: ClickHouseStoredObjectsRepository;
  private readonly prisma: Pick<PrismaClient, "project" | "dataset">;

  constructor(input: {
    repository: ClickHouseStoredObjectsRepository;
    prisma: Pick<PrismaClient, "project" | "dataset">;
  }) {
    super();
    this.repository = input.repository;
    this.prisma = input.prisma;
  }

  async listProjectsPage({ afterId, limit }: MigrationPageRequest): Promise<MigrationProject[]> {
    const projects = await this.prisma.project.findMany({
      where: afterId ? { id: { gt: afterId } } : undefined,
      orderBy: { id: "asc" },
      take: limit,
      select: { id: true },
    });

    return projects.map((project) => ({ id: project.id, privateS3: false }));
  }

  listStoredObjectsPage(
    projectId: string,
    { afterId, limit }: MigrationPageRequest,
  ): Promise<StoredObject[]> {
    return this.repository.findLiveRowsByProjectPage({ projectId, afterId, limit });
  }

  /**
   * `projectId` is mandatory twice over: the multitenancy middleware rejects a
   * Dataset query without one, and the migration's own scope guarantees rely on
   * only eligible projects being asked for.
   */
  listDatasetsPage(
    projectId: string,
    { afterId, limit }: MigrationPageRequest,
  ): Promise<MigrationDataset[]> {
    return this.prisma.dataset.findMany({
      where: { projectId, ...(afterId ? { id: { gt: afterId } } : {}) },
      orderBy: { id: "asc" },
      take: limit,
      select: { id: true, projectId: true, contentLayout: true, status: true, chunkCount: true },
    });
  }
}

/**
 * Builds the `object-storage-migrate` task, deferred to `run()`. The BYOC exclusion is
 * empty here: this process composes no route map of privately-hosted organizations, so
 * every project this task sees is treated as eligible (`privateS3: false`).
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
        inventory: new TasksObjectStorageMigrationInventory({
          repository,
          prisma: host.requirePrisma(),
        }),
        publishStoredObject: (row) => repository.insert({ projectId: row.project_id, row }),
        auditQueues: () => auditQueuesForCutover({ url: host.config.redisUrl }),
        s3Driver: MigrationBlobS3Repository.create({ aws, config: config.s3 }),
      });
    },
  });
}
