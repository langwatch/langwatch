import { mintStoredObjectUri, ObjectNotFoundError } from "@langwatch/stored-object-contract";
import {
  PrometheusStoredObjectsTelemetryAdapter,
  StoredObjectsClickHousePort,
  StoredObjectsService,
  type StoredObjectsClickHouseClient,
} from "@langwatch/stored-object-server";
import { ClickHouseStoredObjectsRepository } from "@langwatch/stored-object-server/composition/stored-objects";
import { EventingTopicClusteringScheduleAdapter } from "@langwatch/topic-server";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { EnterpriseWorkerAuditLog } from "@langwatch/enterprise-worker";
import {
  dataRetentionServer,
  PrismaDataRetentionDirectoryRepository,
} from "@langwatch/data-retention-server";
import type { ClickHouseClient } from "@clickhouse/client";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { AuthzGrantsCommandDispatcherPort } from "@langwatch/authz-server";
import type { PrismaConnection } from "@langwatch/prisma-client";
import { createApp, type ResourceScope } from "@langwatch/runtime-composition";
import type { RedisConnection } from "@langwatch/redis-client";
import type { ProjectInfrastructure } from "@langwatch/project-server";
import {
  createWorkerTenancyInfrastructure,
  WorkerDataRetentionPlans,
} from "./worker-tenancy-infrastructure.composition.ts";
import { installWorkerTenancy } from "./worker-tenancy.composition.ts";
import { installWorkerUser, WorkerUserAvatarStorage } from "./worker-user-app.composition.ts";
import { installWorkerOps } from "./worker-ops-app.composition.ts";
import type { WorkerConfig } from "../platform/config/worker.config.ts";
import type { WorkerEventingRuntime } from "../platform/eventing/worker-eventing.runtime.ts";
import type { WorkerObjectStorage } from "./worker-object-storage.composition.ts";

/** The worker's shared tenancy, identity and operations APIs, constructed once. */
export type WorkerFoundationApps = Readonly<{
  tenancy: import("./worker-tenancy.composition.ts").WorkerTenancy;
  users: import("@langwatch/user-contract").UserApi;
  auth: import("@langwatch/auth-contract").AuthApi;
  ops: import("@langwatch/ops-contract").OpsApi;
  /** The one audit log this process records every management act on. */
  auditLog: AuditLogApi;
  retention: import("@langwatch/data-retention-contract").DataRetentionApi;
  close(): Promise<void>;
}>;

export async function createWorkerFoundationApps(options: {
  connection: PrismaConnection;
  config: WorkerConfig;
  redis: RedisConnection;
  storage: WorkerObjectStorage;
  eventing: WorkerEventingRuntime;
  clickhouse: {
    resolveClient(tenantId: string): Promise<ClickHouseClient>;
    eventLogClient(): ClickHouseClient;
  };
  plans: PlanProvider;
  featureFlags: FeatureFlagApi;
  resources: ResourceScope;
  authzDispatcher: AuthzGrantsCommandDispatcherPort;
  topicClustering: ProjectInfrastructure["topicClustering"];
}): Promise<WorkerFoundationApps> {
  const storedObjects = createWorkerStoredObjects({
    storage: options.storage,
    resolveClient: options.clickhouse.resolveClient,
  });
  const tenancy = createWorkerTenancyInfrastructure({
    connection: options.connection,
    redis: options.redis,
    config: options.config,
    plans: options.plans,
    authzDispatcher: options.authzDispatcher,
    topicClustering: options.topicClustering,
    topicSchedule: EventingTopicClusteringScheduleAdapter.create({
      processStore: options.eventing.processStore,
    }),
    dataRetention: {
      // The organization lineage a rule is placed and gated against, over this
      // process's ONE connection, and the plan behind the gate reduced to the
      // two facts retention tiers on.
      directory: PrismaDataRetentionDirectoryRepository.create(options.connection.client),
      plans: WorkerDataRetentionPlans.create(options.plans),
      resolveClickHouseClient: options.clickhouse.resolveClient,
    },
  });
  const auditLog = await EnterpriseWorkerAuditLog.create({ prisma: options.connection.client });
  options.resources.own("worker audit log", () => auditLog.stop());

  const builder = createApp({ name: "langwatch-worker-foundation" })
    .withPersistence("postgres", { prisma: options.connection.client })
    .withInfrastructure({});
  builder.withProvided(AuditLogApi, auditLog.auditLog());
  installWorkerTenancy(builder, tenancy);
  installWorkerUser(builder, {
    connection: options.connection,
    redis: options.redis,
    avatarStorage: WorkerUserAvatarStorage.create(storedObjects),
  });
  installWorkerOps(builder, {
    connection: options.connection,
    redis: options.redis,
    eventLogClient: options.clickhouse.eventLogClient(),
    resolveReplayClient: options.clickhouse.resolveClient,
    eventing: options.eventing.eventSourcing,
    processStore: options.eventing.processStore,
    featureFlags: options.featureFlags,
    adminEmails: options.config.deployment.adminEmails ?? "",
  });
  const runtime = await builder.boot({
    role: "worker",
    config: {
      "data-retention": { platformDefaultRetentionDays: options.config.retention.defaultDays },
    },
  });
  options.resources.own("worker foundation apps", () => runtime.stop());

  return {
    tenancy: {
      projects: runtime.module((await import("@langwatch/project-server")).projectServer).provided,
      organizations: runtime.module(
        (await import("@langwatch/organization-server")).organizationServer,
      ).provided,
      authorization: runtime.module((await import("@langwatch/authz-server")).authzServer).provided,
      apiKeys: runtime.module((await import("@langwatch/api-key-server")).apiKeyServer).provided,
      shares: runtime.module((await import("@langwatch/share-server")).shareServer).provided,
      topics: runtime.module((await import("@langwatch/topic-server")).topicServer).provided,
      close: () => runtime.stop(),
    },
    users: runtime.module((await import("@langwatch/user-server")).userServer).provided,
    auth: runtime.module((await import("@langwatch/auth-server")).authServer).provided,
    ops: runtime.module((await import("@langwatch/ops-server")).opsServer).provided,
    auditLog: auditLog.auditLog(),
    retention: runtime.module(dataRetentionServer).provided,
    close: () => runtime.stop(),
  };
}

function createWorkerStoredObjects(options: {
  storage: WorkerObjectStorage;
  resolveClient(tenantId: string): Promise<ClickHouseClient>;
}): StoredObjectsService {
  return StoredObjectsService.create({
    repository: ClickHouseStoredObjectsRepository.create(
      WorkerStoredObjectsClickHouse.create(options.resolveClient),
    ),
    registry: (projectId) =>
      WorkerStoredObjectsStorage.create(
        options.storage.runtime.forProject(projectId, options.storage.aws).objectStore,
      ),
    mintStorageUri: async ({ projectId, sha256 }) => {
      const project = options.storage.runtime.forProject(projectId, options.storage.aws);
      return mintStoredObjectUri({
        destination: await project.resolveDestination(),
        objectPath: `${projectId}/${sha256}`,
      });
    },
    telemetry: PrometheusStoredObjectsTelemetryAdapter.create(),
  });
}

class WorkerStoredObjectsClickHouse extends StoredObjectsClickHousePort {
  static create(
    resolveClient: (tenantId: string) => Promise<ClickHouseClient>,
  ): WorkerStoredObjectsClickHouse {
    return new WorkerStoredObjectsClickHouse(resolveClient);
  }

  private constructor(
    private readonly resolveClientForTenant: (tenantId: string) => Promise<ClickHouseClient>,
  ) {
    super();
  }

  async resolveClient(projectId: string): Promise<StoredObjectsClickHouseClient> {
    return WorkerStoredObjectsClickHouseClient.create(await this.resolveClientForTenant(projectId));
  }
}

class WorkerStoredObjectsStorage {
  static create(store: {
    get(uri: string): Promise<import("node:stream").Readable>;
    put(uri: string, bytes: Buffer, mediaType: string): Promise<void>;
    delete(uri: string): Promise<void>;
  }): WorkerStoredObjectsStorage {
    return new WorkerStoredObjectsStorage(store);
  }

  private constructor(
    private readonly store: {
      get(uri: string): Promise<import("node:stream").Readable>;
      put(uri: string, bytes: Buffer, mediaType: string): Promise<void>;
      delete(uri: string): Promise<void>;
    },
  ) {}

  get(uri: string) {
    return this.store.get(uri);
  }

  put(uri: string, bytes: Buffer, mediaType: string): Promise<void> {
    return this.store.put(uri, bytes, mediaType);
  }

  delete(uri: string): Promise<void> {
    return this.store.delete(uri);
  }

  async exists(uri: string): Promise<boolean> {
    try {
      const stream = await this.store.get(uri);
      stream.destroy();
      return true;
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return false;
      throw error;
    }
  }
}

class WorkerStoredObjectsClickHouseClient implements StoredObjectsClickHouseClient {
  static create(client: ClickHouseClient): WorkerStoredObjectsClickHouseClient {
    return new WorkerStoredObjectsClickHouseClient(client);
  }

  private constructor(private readonly client: ClickHouseClient) {}

  async insert(input: {
    table: string;
    values: readonly Record<string, unknown>[];
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, unknown>;
  }): Promise<void> {
    await this.client.insert({
      table: input.table,
      values: input.values,
      format: input.format,
      ...(input.clickhouse_settings
        ? { clickhouse_settings: clickHouseSettings(input.clickhouse_settings) }
        : {}),
    });
  }

  query(input: { query: string; query_params: Record<string, unknown>; format: "JSONEachRow" }) {
    return this.client.query(input);
  }

  async exec(input: {
    query: string;
    query_params: Record<string, unknown>;
    clickhouse_settings?: Record<string, unknown>;
  }): Promise<void> {
    await this.client.exec({
      query: input.query,
      query_params: input.query_params,
      ...(input.clickhouse_settings
        ? { clickhouse_settings: clickHouseSettings(input.clickhouse_settings) }
        : {}),
    });
  }
}

function clickHouseSettings(
  input: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const settings: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      settings[key] = value;
    }
  }
  return settings;
}
