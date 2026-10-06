import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  type EventSourcing,
  ReplayService as EventingReplayService,
  replayLeanOf,
  replayProjectionsOf,
} from "@langwatch/eventing";
import { EventingClickHouseReplayEventSource } from "@langwatch/eventing/server";
import type { Logger } from "@langwatch/observability";
import {
  type OpsServerConfig,
  type OpsBlockedSummary,
  type OpsParkedTenantsPage,
  type OpsQueueReconcileOutcome,
  type QueueInfo,
} from "@langwatch/ops-contract";
/**
 * Builds the {@link OpsAppInfrastructure} `apps/api/src/features/ops/ops.composition.ts`
 * (deleted by b383462d96) used to hand-compose. Answers each api-unavailable
 * capability with its named refusal, exactly as that composition did.
 */
import type { ResourceOwnership } from "@langwatch/process";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { Instant } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";

import type { AnomalyRateTrackerRepository } from "../repositories/anomaly.repository.ts";
import { OpsClickHouseRuntime } from "../repositories/clickhouse/clickhouse.ops-explain.repository.ts";
import { OpsQueueMetricsSourceRepository } from "../repositories/ops-queue-metrics-source.repository.ts";
import type { OpsRepositories } from "../repositories/ops.repositories.ts";
import { PrismaProcessAuditRepository } from "../repositories/prisma/prisma.process-audit.repository.ts";
import {
  PrismaSchedulerAuditRepository,
  type SchedulerAuditDatabase,
} from "../repositories/prisma/prisma.scheduler-audit.repository.ts";
import type { StorageFootprintRepository } from "../repositories/storage-footprint.repository.ts";
import {
  type AdminAccess,
  AdminAccessService,
  type AdminAccessServiceOptions,
} from "../services/admin-access.service.ts";
import { AdminAuditService } from "../services/admin-audit.service.ts";
import {
  AdminBackofficeService,
  type OrganizationSsoRouting,
} from "../services/admin-backoffice.service.ts";
import { BlobStoreService } from "../services/blob-store.service.ts";
import { EventExplorerService } from "../services/event-explorer.service.ts";
import { EventingIntrospectionService } from "../services/eventing-introspection.service.ts";
import { type AdminAuditSink, ImpersonationService } from "../services/impersonation.service.ts";
import { ManagerExplorerService } from "../services/manager-explorer.service.ts";
import { OpsMetricsCollectorService } from "../services/ops-metrics-collector.service.ts";
import { DefaultOpsSnapshotService } from "../services/ops-snapshot-reader.service.ts";
import { OpsService } from "../services/ops.service.ts";
import { QueueAuditService } from "../services/queue-audit.service.ts";
import { QueueService } from "../services/queue.service.ts";
import { ReplayRetentionService } from "../services/replay-retention.service.ts";
import { ReplayService } from "../services/replay.service.ts";
import { SchedulerOpsService } from "../services/scheduler-ops.service.ts";
import type { StorageStatsInstance } from "../services/storage-stats-collection.service.ts";
import { SystemMigrationPassService } from "../services/system-migration-pass.service.ts";
import type {
  OpsExplorers,
  OpsAppDependencies,
  OpsAppInfrastructure,
  OpsCapability,
  OpsEventExplorer,
  OpsProcessExplorer,
  OpsReplayRuntime,
  OpsReplayRuntimeFactory,
} from "./ops.app.ts";

/** What `buildOpsInfrastructure` reads off the process's own members. */
export type OpsProcessMembers = Readonly<{
  prisma: ProcessMembers["prisma"];
  redis: RedisConnection;
  clickhouse: ClickHouseQueryClient;
  /** Cross-pipeline inspection and replay read the registered definitions, nothing more. */
  eventing: Pick<EventSourcing, "definitions">;
}>;

/**
 * One replay run's engine over the pipelines this process registered: the event log read through
 * the routed member itself (§7), markers on a standalone Redis connection sharing no socket with
 * live traffic. A Cluster refuses replay's multi-key operations (CROSSSLOT), as on main.
 */
class OpsReplayRuntimes implements OpsReplayRuntimeFactory {
  constructor(
    private readonly input: Readonly<{
      members: Pick<OpsProcessMembers, "redis" | "clickhouse" | "eventing">;
      retention: OpsAppDependencies["retention"];
    }>,
  ) {}

  create(): OpsReplayRuntime {
    const { redis, clickhouse, eventing } = this.input.members;
    if (redis.isCluster) {
      throw new Error(
        "Replay requires a standalone Redis: a Cluster refuses its multi-key operations.",
      );
    }
    const connection = redis.duplicate();
    const definitions = eventing.definitions;
    const service = new EventingReplayService({
      eventSource: new EventingClickHouseReplayEventSource({
        clickhouse,
        lean: replayLeanOf(definitions),
      }),
      redis: connection,
      retentionPolicyResolver: ReplayRetentionService.create(this.input.retention),
    });
    return {
      service,
      ...replayProjectionsOf(definitions),
      close: async () => {
        connection.disconnect();
      },
    };
  }
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

/** The one endpoint storage stats measure: the shared ClickHouse, as main's worker did. */
export function sharedStorageStatsInstance(
  storage: StorageFootprintRepository,
): StorageStatsInstance {
  return { target: "shared", storage };
}

/** Builds the {@link OpsAppInfrastructure} `OpsModule.create` composes over. */
export function buildOpsInfrastructure(input: {
  members: OpsProcessMembers;
  logger: Logger;
  config: OpsServerConfig;
  resources: ResourceOwnership;
  repositories: OpsRepositories;
  rateTracker: AnomalyRateTrackerRepository;
  cloudOps: boolean;
}): OpsAppInfrastructure {
  const { members, logger, config, resources, repositories } = input;
  const introspection = EventingIntrospectionService.create(() => members.eventing.definitions);

  const snapshots = DefaultOpsSnapshotService.create(repositories.snapshots);
  // Polling starts here rather than on first read: the dashboard, the badge and
  // the live stream all read the last artifact this process pulled.
  snapshots.start().catch((error: unknown) => {
    logger.error({ error }, "failed to start the ops snapshot reader");
  });
  resources.own("api ops snapshot reader", () => snapshots.stop());

  // Every serving role, lease-elected across the fleet (ADR-090); stopped before the
  // stores close, so the lease is handed back rather than left to lapse.
  const queueMetricsWriter = OpsMetricsCollectorService.create({
    metrics: repositories.metrics,
    ops: new QueueOpsMetricsSource(QueueService.create({ repo: repositories.queues })),
    rateTracker: input.rateTracker,
    snapshots: DefaultOpsSnapshotService.create(repositories.snapshots),
  });
  resources.ownService({
    name: "ops queue-metrics writer",
    start: () => {
      queueMetricsWriter.start().catch((error: unknown) => {
        logger.error({ error }, "failed to start the ops queue-metrics writer");
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
        authz: dependencies.authz,
        repositories,
        // Where an organization's connection decides its sign-in, editing
        // the legacy `ssoDomain`/`ssoProvider` strings changes nothing a
        // person experiences, so the backoffice refuses rather than accepting
        // a no-op. Asked of identity per organization (ADR-117 §5).
        ssoRouting: organizationSsoRouting(dependencies.identity),
        database: members.prisma,
        audit: AdminAuditService.create({ auditLog: dependencies.auditLog }),
        auditLog: dependencies.auditLog,
        users: dependencies.users,
        scheduler: {
          schedules: dependencies.automations,
          projects: dependencies.projects,
        },
        explorers: {
          eventExplorer: EventExplorerService.create({
            repo: repositories.events,
            introspection,
          }) satisfies OpsEventExplorer,
          managerExplorer: ManagerExplorerService.create({
            store: repositories.processStore,
            fleet: repositories.processFleet,
            audit: PrismaProcessAuditRepository.create({
              prisma: members.prisma,
              auditLog: dependencies.auditLog,
            }),
            introspection,
          }) satisfies OpsProcessExplorer,
          // Every role reads, cancels and starts; only the worker hosting
          // `ops_projection_replay` builds a runtime and executes.
          replay: ReplayService.create({
            repo: repositories.replay,
            runtimeFactory: new OpsReplayRuntimes({
              members,
              retention: dependencies.retention,
            }),
          }),
          // Read-only here: the worker holds the lease and writes the
          // artifact; a second writer would publish a second answer.
          snapshots,
        },
      }).build();
    },
    eventingIntrospection: introspection,
    pipelines: introspection,
    // Three operator readings this process composes nothing for. Each answers
    // its empty shape rather than refusing: the back office renders the page
    // and shows nothing registered, which is what is true here.
    eventLogWindow: {
      read: () => ({ searchLookbackDays: 7, hotTierDays: null, hotTierEnvVar: null }),
    },
    grafana: { findLinkConfig: () => null },
    createSystemMigrations: ({ dependencies, passRequests }) =>
      SystemMigrationPassService.runner({
        repositories,
        isSaaS: () => config.isSaas,
        routes: () => members.clickhouse.privateRoutes(),
        dependencies,
        passRequests,
      }),
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
    isProduction: config.nodeEnvironment === "production",
    cloudOps: input.cloudOps,
    // Cloud never bootstraps: staff are seeded at cutover with the recovery task.
    operatorSeed: { adminEmails: config.adminEmails, cloud: config.isSaas || input.cloudOps },
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

export interface OpsOperationsOptions {
  authz: AdminAccessServiceOptions["authz"];
  /** The stores the operations read and edit, as the registry built them. */
  repositories: Pick<
    OpsRepositories,
    "instanceAdmin" | "impersonation" | "queues" | "blobStore" | "anomalyState"
  >;
  /** What the scheduler's audit trail reads; the trail itself also takes the audit log. */
  database: SchedulerAuditDatabase;
  audit: AdminAuditSink;
  /** The shared audit log every operator act is recorded on. */
  auditLog: AuditLogApi;
  access?: AdminAccess | undefined;
  now?: (() => Instant) | undefined;
  users: UserApi;
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
      this.options.access ??
      AdminAccessService.create({ authz: this.options.authz, users: this.options.users });
    const { repositories } = this.options;
    const queues = QueueService.create({
      repo: repositories.queues,
      audit: QueueAuditService.create({ auditLog: this.options.auditLog }),
    });

    return OpsService.create({
      access,
      adminBackoffice: AdminBackofficeService.create({
        repository: repositories.instanceAdmin,
        users: this.options.users,
        audit: this.options.audit,
        ssoRouting: this.options.ssoRouting,
      }),
      blobStore: BlobStoreService.create(repositories.blobStore),
      impersonation: ImpersonationService.create({
        repository: repositories.impersonation,
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
      anomalyState: repositories.anomalyState,
      queues,
      explorers: this.options.explorers,
    });
  }
}
