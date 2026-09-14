import { mintStoredObjectUri, ObjectNotFoundError } from "@langwatch/stored-object-contract";
import {
  PrometheusStoredObjectsTelemetryAdapter,
  type StoredObjectsClickHouse,
  StoredObjectsService,
  type StoredObjectsClickHouseClient,
} from "@langwatch/stored-object-server";
import { ClickHouseStoredObjectsRepository } from "@langwatch/stored-object-server/composition/stored-objects";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { EnterpriseWorkerAuditLog } from "@langwatch/enterprise-worker";
import { createActivatedLicenseSource } from "@langwatch/enterprise-licensing-server";
import { dataRetentionServer } from "@langwatch/data-retention-server";
import { apiKeyServer } from "@langwatch/api-key-server";
import { authServer } from "@langwatch/auth-server";
import { authzServer } from "@langwatch/authz-server";
import { opsServer } from "@langwatch/ops-server";
import { organizationServer } from "@langwatch/organization-server";
import { projectServer } from "@langwatch/project-server";
import { roleServer } from "@langwatch/role-server";
import { shareServer } from "@langwatch/share-server";
import { topicServer } from "@langwatch/topic-server";
import { userServer } from "@langwatch/user-server";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { ActivatedLicenseSource, type PlanProvider } from "@langwatch/entitlement-contract";
import type { AuthzGrantsCommandDispatcher } from "@langwatch/authz-server";
import type { PrismaConnection } from "@langwatch/prisma-client";
import { entitlementServer } from "@langwatch/entitlement-server";
import { identityServer } from "@langwatch/identity-server";
import { createApp, membersFrom, type ResourceScope } from "@langwatch/runtime-composition";
import type { RedisConnection } from "@langwatch/redis-client";
import type { ProjectInfrastructure } from "@langwatch/project-server";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { AuthzApiContract } from "@langwatch/authz-contract";
import type { ApiKeyApiContract } from "@langwatch/api-key-contract";
import type { ShareApi } from "@langwatch/share-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { OpsApi } from "@langwatch/ops-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { WorkerConfig } from "../platform/config/worker.config.ts";
import type { WorkerEventingRuntime } from "../platform/eventing/worker-eventing.runtime.ts";
import type { WorkerObjectStorage } from "./worker-object-storage.composition.ts";
import { resolveWorkerStoredSecretCipher } from "./worker-automation-graph.composition.ts";
import { workerClosedDoors } from "../platform/transports/worker-closed-doors.ts";

/** The worker's installed, complete callable tenancy surfaces. */
export type WorkerTenancy = Readonly<{
  projects: ProjectApi;
  organizations: OrganizationApi;
  authorization: AuthzApiContract;
  apiKeys: ApiKeyApiContract;
  shares: ShareApi;
  topics: TopicApi;
  close(): Promise<void>;
}>;

/** The worker's shared tenancy, identity and operations APIs, constructed once. */
export type WorkerFoundationApps = Readonly<{
  tenancy: WorkerTenancy;
  users: UserApi;
  auth: AuthApi;
  ops: OpsApi;
  /** The one audit log this process records every management act on. */
  auditLog: AuditLogApi;
  retention: DataRetentionApi;
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
    /** The process's one routed query client, over the same connection. */
    queryClient: ClickHouseQueryClient;
  };
  plans: PlanProvider;
  featureFlags: FeatureFlagApi;
  resources: ResourceScope;
  /**
   * No longer read: AuthzApp builds its own command dispatcher over the
   * `eventing` member (see modules/authz/server/src/app/authz.app.ts). Kept on
   * this options record so the process root, which still allocates one before
   * this function runs, does not need a matching change.
   */
  authzDispatcher: AuthzGrantsCommandDispatcher;
  /**
   * No longer wired: ProjectApp reads `members.topicClustering`, but no
   * installed module declares `topicClustering` as a `reads()` member and the
   * process's fourteen-member vocabulary (@langwatch/infrastructure/members)
   * has no such name, so there is no seam to supply it through. Recorded in
   * the handoff for worker-foundation-v2; the fix belongs to project's module
   * conversion, not to this composition.
   */
  topicClustering: ProjectInfrastructure["topicClustering"];
}): Promise<WorkerFoundationApps> {
  createWorkerStoredObjects({
    storage: options.storage,
    resolveClient: options.clickhouse.resolveClient,
  });
  const auditLog = await EnterpriseWorkerAuditLog.create({ prisma: options.connection.client });
  options.resources.own("worker audit log", () => auditLog.stop());

  // The licence leg of plan resolution: `EntitlementApp` declares this as a
  // mandatory dependency, so this process must supply it, through the SAME
  // one factory (and the SAME public key) the standalone gateway-spend plan
  // provider gives the licence leg in `worker-plan-provider.composition.ts`
  // — so both graphs agree on whether a deployment is licensed.
  const licenseSource = createActivatedLicenseSource({
    prisma: options.connection.client,
    ...(options.config.deployment.licensePublicKey
      ? { licensePublicKey: options.config.deployment.licensePublicKey }
      : {}),
    isSaas: options.config.deployment.saas,
  });

  const runtime = await createApp({
    role: "worker",
    config: {
      "data-retention": { platformDefaultRetentionDays: options.config.retention.defaultDays },
      "api-key": { pepper: options.config.apiKeyPepper },
      // `registersPipelines: false`: this process DRAINS the four identity
      // ledgers, and its install phase registers their complete Postgres
      // definitions. Identity's producer registration beside them would be a
      // second registration of each name, which the runtime refuses.
      identity: { adminEmails: adminEmails(options.config), registersPipelines: false },
      organization: {
        processName: options.config.serviceName,
        demoProject: { userId: "", projectId: options.config.authz.demoProjectId ?? "" },
      },
      /** Same deployment facts the api hands entitlement; its schema refuses an absent key. */
      entitlement: {
        processName: options.config.serviceName,
        isSaas: options.config.deployment.saas,
      },
      ops: {
        adminEmails: adminEmails(options.config),
        isProduction: options.config.nodeEnvironment === "production",
      },
    },
    members: membersFrom({
      prisma: options.connection.client,
      redis: options.redis,
      clickhouse: options.clickhouse.queryClient,
      eventing: options.eventing.eventSourcing,
      logger: createLogger(options.config.serviceName),
      // The SAME cipher the automation graph reads stored credentials with —
      // a second cipher would not fail, it would decrypt to noise.
      encryption: resolveWorkerStoredSecretCipher(options.config),
    }),
  })
    .withTransports(workerClosedDoors())
    .withProvided(AuditLogApi, auditLog.auditLog())
    .withProvided(ActivatedLicenseSource, licenseSource)
    .withProvided(FeatureFlagApi, options.featureFlags)
    .withModules([
      authzServer,
      // organization declares dependencies on identity, entitlement and role; the
      // worker installs the providers rather than leaving them unanswerable.
      identityServer,
      entitlementServer,
      roleServer,
      organizationServer,
      projectServer,
      apiKeyServer,
      dataRetentionServer,
      shareServer,
      topicServer,
      userServer,
      authServer,
      opsServer,
    ])
    .boot();
  options.resources.own("worker foundation apps", () => runtime.stop());

  return {
    tenancy: {
      projects: runtime.module(projectServer).provided,
      organizations: runtime.module(organizationServer).provided,
      authorization: runtime.module(authzServer).provided,
      apiKeys: runtime.module(apiKeyServer).provided,
      shares: runtime.module(shareServer).provided,
      topics: runtime.module(topicServer).provided,
      close: () => runtime.stop(),
    },
    users: runtime.module(userServer).provided,
    auth: runtime.module(authServer).provided,
    ops: runtime.module(opsServer).provided,
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

class WorkerStoredObjectsClickHouse implements StoredObjectsClickHouse {
  static create(
    resolveClient: (tenantId: string) => Promise<ClickHouseClient>,
  ): WorkerStoredObjectsClickHouse {
    return new WorkerStoredObjectsClickHouse(resolveClient);
  }

  private constructor(
    private readonly resolveClientForTenant: (tenantId: string) => Promise<ClickHouseClient>,
  ) {}

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

/** The platform operators, as the comma-separated ADMIN_EMAILS this deployment named. */
function adminEmails(config: WorkerConfig): string[] {
  return (config.deployment.adminEmails ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}
