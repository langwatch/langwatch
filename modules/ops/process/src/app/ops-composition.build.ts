import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { EventSourcing, ProcessStore } from "@langwatch/eventing";
/**
 * Builds the {@link OpsAppInfrastructure} `apps/api/src/features/ops/ops.composition.ts`
 * (deleted by b383462d96) used to hand-compose. Answers each api-unavailable
 * capability with its named refusal, exactly as that composition did.
 */
import type { ResourceOwnership } from "@langwatch/kernel";
import type { Logger } from "@langwatch/observability";
import {
  OpsCapabilityUnavailableError,
  type OpsServerConfig,
  type OpsBlockedSummary,
  type OpsParkedTenantsPage,
  type OpsQueueReconcileOutcome,
  type QueueInfo,
} from "@langwatch/ops-contract";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { Instant } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";
import type { Cluster, Redis as IORedis } from "ioredis";

import type { AnomalyRateTrackerRepository } from "../repositories/anomaly.repository.ts";
import { NullBlobStoreRepository } from "../repositories/blob-store.repository.ts";
import { EventExplorerClickHouseRepository } from "../repositories/clickhouse/clickhouse.event-explorer.repository.ts";
import type { EventExplorerClickHouseClient } from "../repositories/clickhouse/clickhouse.event-explorer.repository.ts";
import { OpsClickHouseRuntime } from "../repositories/clickhouse/clickhouse.ops-explain.repository.ts";
import { OpsQueueMetricsSourceRepository } from "../repositories/ops-queue-metrics-source.repository.ts";
import { PrismaAdminBackofficeRepository } from "../repositories/prisma/prisma.admin-backoffice.repository.ts";
import {
  type AdminDatabase,
  PrismaImpersonationRepository,
} from "../repositories/prisma/prisma.admin.repository.ts";
import { PrismaProcessAuditRepository } from "../repositories/prisma/prisma.process-audit.repository.ts";
import { ProcessOpsPrismaRepository } from "../repositories/prisma/prisma.process-ops.repository.ts";
import {
  PrismaSchedulerAuditRepository,
  type SchedulerAuditDatabase,
} from "../repositories/prisma/prisma.scheduler-audit.repository.ts";
import { NullQueueRepository } from "../repositories/queue.repository.ts";
import { QueueRedisRepository } from "../repositories/redis/queue.repository.ts";
import { RedisAnomalyStateRepository } from "../repositories/redis/redis.anomaly-state.repository.ts";
import { BlobStoreRedisRepository } from "../repositories/redis/redis.blob-store.repository.ts";
import { RedisOpsMetricsRepository } from "../repositories/redis/redis.ops-metrics.repository.ts";
import { RedisOpsSnapshotRepository } from "../repositories/redis/redis.ops-snapshot.repository.ts";
import {
  type AdminAccess,
  AdminAccessService,
  type AdminAccessServiceOptions,
} from "../services/admin-access.service.ts";
import {
  AdminBackofficeService,
  type OrganizationSsoRouting,
} from "../services/admin-backoffice.service.ts";
import { BlobStoreService } from "../services/blob-store.service.ts";
import { EventExplorerService } from "../services/event-explorer.service.ts";
import { EventingIntrospectionService } from "../services/eventing-introspection.service.ts";
import { AdminAuditSink, ImpersonationService } from "../services/impersonation.service.ts";
import { ManagerExplorerService } from "../services/manager-explorer.service.ts";
import { OpsMetricsCollectorService } from "../services/ops-metrics-collector.service.ts";
import { DefaultOpsSnapshotService } from "../services/ops-snapshot-reader.service.ts";
import { OpsService } from "../services/ops.service.ts";
import { QueueAuditService } from "../services/queue-audit.service.ts";
import { QueueService } from "../services/queue.service.ts";
import { SchedulerOpsService } from "../services/scheduler-ops.service.ts";
import type {
  StorageStatsClickHouseClient,
  StorageStatsInstance,
} from "../services/storage-stats-collection.service.ts";
import type {
  OpsExplorers,
  QueuePayloadDecoder,
  OpsAppDependencies,
  OpsAppInfrastructure,
  OpsCapability,
  OpsEventExplorer,
  OpsProcessExplorer,
  OpsReplayRunner,
  OpsSystemMigrationRunner,
} from "./ops.app.ts";

/** What `buildOpsInfrastructure` reads off the process's own members. */
export type OpsProcessMembers = Readonly<{
  prisma: ProcessMembers["prisma"];
  redis: RedisConnection;
  clickhouse: ClickHouseQueryClient;
  eventing: EventSourcing;
  logger: Logger;
  /** The process's own fact (§6), for the EXPLAIN fail-closed rule. */
  nodeEnvironment: string | undefined;
  /** Who reaches the back office — the deployment's own list, named raw
   *  because it is a fact about the installation, not a store. */
  adminEmails: readonly string[];
  /** The process's own facts the checkup and the usage report name. */
  isSaas: boolean;
  serviceVersion: string;
  publicBaseUrl: string | undefined;
  processName: string;
}>;

/** The replay runner this process has none of, refused by name on every method. */
class UnavailableReplayRunner implements OpsReplayRunner {
  readonly #refusal = () => new OpsCapabilityUnavailableError("the projection replay runner");

  getHistory = () => Promise.reject(this.#refusal());
  findHistoryEntry = () => Promise.reject(this.#refusal());
  startReplay = () => Promise.reject(this.#refusal());
  getStatus = () => Promise.reject(this.#refusal());
  cancelReplay = () => Promise.reject(this.#refusal());
}

/** The system migration runner this process has none of, refused by name on every method. */
class UnavailableSystemMigrationRunner implements OpsSystemMigrationRunner {
  readonly #refusal = () => new OpsCapabilityUnavailableError("the system migration runner");

  getOverview = () => Promise.reject(this.#refusal());
  getEnrollments = () => Promise.reject(this.#refusal());
  searchOrganizations = () => Promise.reject(this.#refusal());
  requiresOperatorConfirmation = (): boolean => {
    throw this.#refusal();
  };
  enroll = () => Promise.reject(this.#refusal());
  enrollCohort = () => Promise.reject(this.#refusal());
  withdraw = () => Promise.reject(this.#refusal());
  runForOrganization = () => Promise.reject(this.#refusal());
  startPass = (): void => {
    throw this.#refusal();
  };
  assertLegacyWritersDrained = () => Promise.reject(this.#refusal());
  rollBack = () => Promise.reject(this.#refusal());
}

/** The writer's queue reads over the queue service alone, for a process with no Postgres. */
class QueueOpsMetricsSource extends OpsQueueMetricsSourceRepository {
  constructor(private readonly queues: QueueService) {
    super();
  }

  discoverQueueNames(): Promise<string[]> {
    return this.queues.discoverQueueNames();
  }

  scanQueues(input: { queueNames: string[] }): Promise<QueueInfo[]> {
    return this.queues.scanQueues(input);
  }

  reconcileQueuePending(input: { queueName: string }): Promise<OpsQueueReconcileOutcome> {
    return this.queues.reconcilePending(input);
  }

  readQueuePendingDrift(input: { queueNames: string[] }): Promise<number> {
    return this.queues.readPublishedPendingDrift(input);
  }

  getBlockedQueueSummary(): Promise<OpsBlockedSummary> {
    return this.queues.getBlockedSummary();
  }

  listParkedQueueTenants(input: {
    queueNames: string[];
    maxTenants: number;
  }): Promise<OpsParkedTenantsPage> {
    return this.queues.listParkedTenants(input);
  }
}

/**
 * Adapts the routed ClickHouse client to the event explorer's driver-shaped
 * interface. A named `tenantId` routes to that tenant; an `unscoped` call
 * routes to the shared server (`tenantId: ""`, see `routingDriver.ts`).
 */
class RoutedEventExplorerClickHouseClient implements EventExplorerClickHouseClient {
  constructor(private readonly clickhouse: ClickHouseQueryClient) {}

  async query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    unscoped?: { reason: string };
  }): Promise<{ json(): Promise<unknown> }> {
    const namedTenantId = input.query_params?.tenantId;
    const tenantId = typeof namedTenantId === "string" ? namedTenantId : "";
    const result = await this.clickhouse.query({
      tenantId,
      sql: input.query,
      ...(input.query_params ? { params: input.query_params } : {}),
      ...(input.unscoped ? { unscoped: input.unscoped } : {}),
    });
    return { json: async () => result.rows };
  }
}

/** The storage-stats reads, unscoped, on the shared server (`tenantId: ""`) as main read them. */
class SharedStorageStatsClickHouseClient implements StorageStatsClickHouseClient {
  constructor(private readonly clickhouse: ClickHouseQueryClient) {}

  async query<Row>(input: {
    query: string;
    query_params?: Record<string, readonly string[]>;
    unscoped?: { reason: string };
  }): Promise<{ data: Row[] }> {
    const result = await this.clickhouse.query<Row>({
      tenantId: "",
      sql: input.query,
      ...(input.query_params ? { params: input.query_params } : {}),
      ...(input.unscoped ? { unscoped: input.unscoped } : {}),
    });
    return { data: result.rows };
  }
}

/** The one endpoint storage stats measure: the shared ClickHouse, as main's worker did. */
export function sharedStorageStatsInstance(
  clickhouse: ClickHouseQueryClient,
): StorageStatsInstance {
  return { target: "shared", client: new SharedStorageStatsClickHouseClient(clickhouse) };
}

/** Warns rather than records: this process holds no admin-action audit port of its own. */
class UnauditedOpsAuditSink extends AdminAuditSink {
  constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  async record(entry: { action: string }): Promise<void> {
    this.logger.warn(
      { action: entry.action },
      "operator action not audited: this process composed no admin-action audit sink",
    );
  }
}

/** Builds the {@link OpsAppInfrastructure} `OpsApp.create` composes over. */
export function buildOpsInfrastructure(input: {
  members: OpsProcessMembers;
  config: OpsServerConfig;
  resources: ResourceOwnership;
  processStore: ProcessStore;
  rateTracker: AnomalyRateTrackerRepository;
}): OpsAppInfrastructure {
  const { members, config, resources } = input;
  const introspection = EventingIntrospectionService.create(() => members.eventing.definitions);

  const snapshots = DefaultOpsSnapshotService.create(
    RedisOpsSnapshotRepository.create(members.redis),
  );
  // Polling starts here rather than on first read: the dashboard, the badge and
  // the live stream all read the last artifact this process pulled.
  snapshots.start().catch((error: unknown) => {
    members.logger.error({ error }, "failed to start the ops snapshot reader");
  });
  resources.own("api ops snapshot reader", () => snapshots.stop());

  // Every serving role, lease-elected across the fleet (ADR-090); stopped before the
  // stores close, so the lease is handed back rather than left to lapse.
  const queueMetricsWriter = OpsMetricsCollectorService.create({
    metrics: RedisOpsMetricsRepository.create({ redis: members.redis }),
    ops: new QueueOpsMetricsSource(
      QueueService.create({ repo: QueueRedisRepository.create({ redis: members.redis }) }),
    ),
    rateTracker: input.rateTracker,
    snapshots: DefaultOpsSnapshotService.create(RedisOpsSnapshotRepository.create(members.redis)),
  });
  resources.ownService({
    name: "ops queue-metrics writer",
    start: () => {
      queueMetricsWriter.start().catch((error: unknown) => {
        members.logger.error({ error }, "failed to start the ops queue-metrics writer");
      });
    },
    stop: () => queueMetricsWriter.stop(),
  });

  const explainRuntime = OpsClickHouseRuntime.create({
    url: config.clickhouseOpsUrl,
    buildTime: false,
  });
  resources.own("api ops explain client", () => explainRuntime.close());

  return {
    createCapability: (dependencies: OpsAppDependencies): OpsCapability => {
      return OpsOperations.create({
        adminEmails: members.adminEmails,
        // Where an organization's connection decides its sign-in, editing
        // the legacy `ssoDomain`/`ssoProvider` strings changes nothing a
        // person experiences, so the backoffice refuses rather than accepting
        // a no-op. Asked of identity per organization (ADR-117 §5).
        ssoRouting: organizationSsoRouting(dependencies.identity),
        database: members.prisma,
        audit: new UnauditedOpsAuditSink(members.logger),
        auditLog: dependencies.auditLog,
        users: dependencies.users,
        auth: dependencies.auth,
        scheduler: {
          schedules: dependencies.automations,
          projects: dependencies.projects,
        },
        explorers: {
          eventExplorer: EventExplorerService.create({
            repo: EventExplorerClickHouseRepository.create({
              client: new RoutedEventExplorerClickHouseClient(members.clickhouse),
            }),
            introspection,
          }) satisfies OpsEventExplorer,
          managerExplorer: ManagerExplorerService.create({
            store: input.processStore,
            fleet: ProcessOpsPrismaRepository.create({ prisma: members.prisma }),
            audit: PrismaProcessAuditRepository.create({
              prisma: members.prisma,
              auditLog: dependencies.auditLog,
            }),
            introspection,
          }) satisfies OpsProcessExplorer,
          // Unconditional: no replay runtime exists in the tree for the api
          // role to compose, whatever this deployment is configured with.
          replay: new UnavailableReplayRunner(),
          // Read-only here: the worker holds the lease and writes the
          // artifact; a second writer would publish a second answer.
          snapshots,
        },
      }).build();
    },
    eventingIntrospection: introspection,
    // Four operator readings this process composes nothing for. Each answers
    // its empty shape rather than refusing: the back office renders the page
    // and shows nothing registered, which is what is true here.
    pipelines: { listRegistrations: () => ({ projections: [], eventSubscribers: [] }) },
    eventLogWindow: {
      read: () => ({ searchLookbackDays: 7, hotTierDays: null, hotTierEnvVar: null }),
    },
    grafana: { findLinkConfig: () => null },
    systemMigrations: new UnavailableSystemMigrationRunner(),
    // The bug-report intake's own flood bound and best-effort alert. This
    // process has neither a dedicated limiter nor a notifier of its own for
    // this endpoint yet, so it allows and answers silently rather than
    // refusing to accept a report that already reached it.
    bugReportRateLimiter: { consume: () => Promise.resolve({ allowed: true }) },
    bugReportNotifier: { notify: () => Promise.resolve() },
    explainClients: explainRuntime,
    findOpsApiKey: () => config.apiKey ?? null,
    findProductAnalyticsTargets: () => {
      const { key, host } = config.productAnalytics;
      return key ? [{ key, ...(host ? { host } : {}) }] : [];
    },
    isProduction: members.nodeEnvironment === "production",
  };
}

/** Which route decides one organization's sign-in, asked of identity: one
 *  holding a connection is routed by it, one holding none is still routed by
 *  its legacy strings, and no installation-wide switch changes both. */
function organizationSsoRouting(identity: OpsAppDependencies["identity"]): OrganizationSsoRouting {
  return {
    connectionDecides: async ({ organizationId }) =>
      (await identity.ssoConnectionReads().findForOrganization({ organizationId })).length > 0,
  };
}

export interface OpsOperationsOptions extends AdminAccessServiceOptions {
  database: AdminDatabase & SchedulerAuditDatabase;
  audit: AdminAuditSink;
  /** The shared audit log every operator act is recorded on. */
  auditLog: AuditLogApi;
  access?: AdminAccess | undefined;
  now?: (() => Instant) | undefined;
  redis?: IORedis | Cluster | undefined;
  queuePayloads?: QueuePayloadDecoder | undefined;
  users: UserApi;
  auth: AuthApi;
  /** Whether one organization's own connection decides its sign-in. */
  ssoRouting?: OrganizationSsoRouting | undefined;
  scheduler: {
    schedules: OpsAppDependencies["automations"];
    projects: ProjectApi;
  };
  /** The explorers, the replay runner and the snapshot reader the capability carries. */
  explorers: OpsExplorers;
}

/**
 * The operations half of the application, built from the repositories and the
 * connections the process hands it. Not a persistence adapter: the backend
 * choice is the registry's, and this is where the services are composed.
 */
export class OpsOperations {
  private constructor(private readonly options: OpsOperationsOptions) {}

  static create(options: OpsOperationsOptions): OpsOperations {
    return new OpsOperations(options);
  }

  build(): OpsCapability {
    const access =
      this.options.access ?? AdminAccessService.create({ adminEmails: this.options.adminEmails });
    const queues = this.options.redis
      ? QueueService.create({
          repo: QueueRedisRepository.create({
            redis: this.options.redis,
            payloads: this.queuePayloads(),
          }),
          audit: QueueAuditService.create({ auditLog: this.options.auditLog }),
        })
      : QueueService.create({ repo: NullQueueRepository.create() });

    return OpsService.create({
      access,
      adminBackoffice: AdminBackofficeService.create({
        repository: PrismaAdminBackofficeRepository.create(this.options.database),
        users: this.options.users,
        auth: this.options.auth,
        audit: this.options.audit,
        ssoRouting: this.options.ssoRouting,
      }),
      blobStore: BlobStoreService.create(
        this.options.redis
          ? BlobStoreRedisRepository.create(this.options.redis)
          : NullBlobStoreRepository.create(),
      ),
      impersonation: ImpersonationService.create({
        repository: PrismaImpersonationRepository.create(this.options.database),
        access,
        audit: this.options.audit,
        now: this.options.now,
      }),
      scheduler: SchedulerOpsService.create({
        ...this.options.scheduler,
        audit: PrismaSchedulerAuditRepository.create({
          database: this.options.database,
          auditLog: this.options.auditLog,
        }),
      }),
      anomalyState: this.options.redis
        ? RedisAnomalyStateRepository.create(this.options.redis)
        : null,
      queues,
      explorers: this.options.explorers,
    });
  }

  private queuePayloads(): QueuePayloadDecoder {
    if (!this.options.queuePayloads) {
      throw new Error("Ops queue composition requires a payload decoder when Redis is configured");
    }

    return this.options.queuePayloads;
  }
}
