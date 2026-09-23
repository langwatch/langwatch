import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { EventSourcing, ProcessStore } from "@langwatch/eventing";
/**
 * Builds the {@link OpsAppInfrastructure} `apps/api/src/features/ops/ops.composition.ts`
 * (deleted by b383462d96) used to hand-compose. Answers each api-unavailable
 * capability with its named refusal, exactly as that composition did.
 */
import { PrismaScheduledJobStore } from "@langwatch/eventing/server";
import type { ResourceOwnership } from "@langwatch/kernel";
import type { Logger } from "@langwatch/observability";
import { OpsCapabilityUnavailableError, type OpsServerConfig } from "@langwatch/ops-contract";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { RedisConnection } from "@langwatch/redis-client";

import { EventExplorerClickHouseRepository } from "../repositories/clickhouse/clickhouse.event-explorer.repository.ts";
import type { EventExplorerClickHouseClient } from "../repositories/clickhouse/clickhouse.event-explorer.repository.ts";
import { OpsClickHouseRuntime } from "../repositories/clickhouse/clickhouse.ops-explain.repository.ts";
import type {
  OpsExplainClientResolution,
  OpsExplainClients,
} from "../repositories/observe/ops-explain.repository.ts";
import { PrismaProcessAuditRepository } from "../repositories/prisma/prisma.process-audit.repository.ts";
import { ProcessOpsPrismaRepository } from "../repositories/prisma/prisma.process-ops.repository.ts";
import { RedisOpsSnapshotRepository } from "../repositories/redis/redis.ops-snapshot.repository.ts";
import type { OrganizationSsoRouting } from "../services/admin-backoffice.service.ts";
import { EventExplorerService } from "../services/event-explorer.service.ts";
import { EventingOpsIntrospectionAdapter } from "../services/eventing.ops-introspection.service.ts";
import { AdminAuditSink } from "../services/impersonation.service.ts";
import { ManagerExplorerService } from "../services/manager-explorer.service.ts";
import { DefaultOpsSnapshotService } from "../services/ops-snapshot-reader.service.ts";
import { NoopSchedulerWakeService } from "../services/scheduler-wake.service.ts";
import { OpsOperations } from "./ops-operations.ts";
import type {
  OpsAppDependencies,
  OpsAppInfrastructure,
  OpsCapability,
  OpsEventExplorer,
  OpsLicenseRegistry,
  OpsProcessExplorer,
  OpsReplayRunner,
  OpsSelfHostedInstances,
  OpsSnapshotRedis,
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

/** One operator explorer, refused by name on every method. */
function unavailableOperatorRuntime<T>(capability: string): T {
  return new Proxy(
    {},
    {
      get: () => () => Promise.reject(new OpsCapabilityUnavailableError(capability)),
      has: () => true,
    },
  ) as T;
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

/**
 * The dedicated `langwatch_ops` readonly account, lazily opened from config.
 * Null when unconfigured — the api never falls back to a shared client here.
 */
class ConfiguredOpsExplainClients implements OpsExplainClients {
  constructor(private readonly runtime: OpsClickHouseRuntime) {}

  findClient(): OpsExplainClientResolution | null {
    const client = this.runtime.resolveClient();
    return client ? { client, usingFallback: false } : null;
  }
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

/** The four Redis commands the snapshot artifact is held under. */
class MemberOpsSnapshotRedis implements OpsSnapshotRedis {
  constructor(private readonly redis: RedisConnection) {}

  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown> {
    return this.redis.eval(script, numberOfKeys, ...args) as Promise<unknown>;
  }

  set(
    key: string,
    value: string,
    expiryMode: "EX",
    expirySeconds: number,
    condition: "NX",
  ): Promise<unknown> {
    return this.redis.set(key, value, expiryMode, expirySeconds, condition);
  }

  tryGet(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }
}

/** Builds the {@link OpsAppInfrastructure} `OpsApp.create` composes over. */
export function buildOpsInfrastructure(input: {
  members: OpsProcessMembers;
  config: OpsServerConfig;
  resources: ResourceOwnership;
  processStore: ProcessStore;
}): OpsAppInfrastructure {
  const { members, config, resources } = input;
  const introspection = EventingOpsIntrospectionAdapter.create(() => members.eventing.definitions);

  const snapshots = DefaultOpsSnapshotService.create(
    RedisOpsSnapshotRepository.create(new MemberOpsSnapshotRedis(members.redis)),
  );
  // Polling starts here rather than on first read: the dashboard, the badge and
  // the live stream all read the last artifact this process pulled.
  snapshots.start().catch((error: unknown) => {
    members.logger.error({ error }, "failed to start the ops snapshot reader");
  });
  resources.own("api ops snapshot reader", () => snapshots.stop());

  const explainRuntime = OpsClickHouseRuntime.create({
    url: config.clickhouseOpsUrl,
    buildTime: false,
  });
  resources.own("api ops explain client", () => explainRuntime.close());
  const explainClients = new ConfiguredOpsExplainClients(explainRuntime);

  return {
    createCapability: (dependencies: OpsAppDependencies): OpsCapability => {
      const operations = OpsOperations.create({
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
          repository: new PrismaScheduledJobStore(members.prisma),
          // The scheduler's own polling backstop preserves correctness
          // without a wake, which is what makes the noop the package's
          // answer rather than a degradation this composition invented.
          wake: NoopSchedulerWakeService.create(),
          projects: dependencies.projects,
        },
      }).build();

      const composed: Record<string, unknown> = {
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
        replay: unavailableOperatorRuntime<OpsReplayRunner>("the projection replay runner"),
        // Read-only here: the worker holds the lease and writes the
        // artifact, and a second writer would publish a second answer for
        // one fleet.
        snapshots,
      };

      // Proxied rather than spread: `operations` is a class, and spreading
      // one drops every method on its prototype.
      return new Proxy(operations, {
        get(target, property) {
          if (typeof property === "string" && property in composed) return composed[property];
          const member: unknown = Reflect.get(target, property);
          return typeof member === "function" ? member.bind(target) : member;
        },
        has: (target, property) =>
          (typeof property === "string" && property in composed) || property in target,
      }) as OpsCapability;
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
    systemMigrations: unavailableOperatorRuntime<OpsSystemMigrationRunner>(
      "the system migration runner",
    ),
    // Real when the enterprise licensing module is installed and its
    // composition overrides this member; refused by name otherwise (§10).
    licenseRegistry: unavailableOperatorRuntime<OpsLicenseRegistry>("the license registry"),
    selfHostedInstances: unavailableOperatorRuntime<OpsSelfHostedInstances>(
      "the self-hosted instance registry",
    ),
    // The bug-report intake's own flood bound and best-effort alert. This
    // process has neither a dedicated limiter nor a notifier of its own for
    // this endpoint yet, so it allows and answers silently rather than
    // refusing to accept a report that already reached it.
    bugReportRateLimiter: { consume: () => Promise.resolve({ allowed: true }) },
    bugReportNotifier: { notify: () => Promise.resolve() },
    explainClients,
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
