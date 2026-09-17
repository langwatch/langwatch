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
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { ActivatedLicenseSource } from "@langwatch/entitlement-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import { entitlementServer } from "@langwatch/entitlement-server";
import { identityServer } from "@langwatch/identity-server";
import { redisRateLimiter } from "@langwatch/infrastructure";
import { createApp, membersFrom, type ResourceScope } from "@langwatch/runtime-composition";
import type { RedisConnection } from "@langwatch/redis-client";
import { createLogger } from "@langwatch/observability";
import { ProjectApi } from "@langwatch/project-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { AuthzApi, type AuthzApiContract } from "@langwatch/authz-contract";
import { ApiKeyApi, type ApiKeyApiContract } from "@langwatch/api-key-contract";
import { ShareApi } from "@langwatch/share-contract";
import { TopicApi } from "@langwatch/topic-contract";
import { UserApi } from "@langwatch/user-contract";
import { AuthApi } from "@langwatch/auth-contract";
import { OpsApi } from "@langwatch/ops-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { WorkerConfig } from "../platform/config/worker.config.ts";
import type { WorkerEventingRuntime } from "../platform/eventing/worker-eventing.runtime.ts";
import { resolveWorkerStoredSecretCipher } from "./worker-automation-graph.composition.ts";
import { workerClosedDoors } from "../platform/transports/worker-closed-doors.ts";

/** The api's own default window, matched so the two processes cannot drift. */
const WORKER_RATE_ALLOWANCE = { requests: 60, seconds: 60 } as const;

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
  eventing: WorkerEventingRuntime;
  clickhouse: {
    /** The process's one routed query client, over the same connection. */
    queryClient: ClickHouseQueryClient;
  };
  featureFlags: FeatureFlagApi;
  resources: ResourceScope;
}): Promise<WorkerFoundationApps> {
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
        /** The boot overrides record, already validated against the registry at config time. */
        requestBounds: options.config.requestBounds,
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
      // `auth` reads a limiter unconditionally, because the operation behind
      // /api/auth/validate needs one and a module cannot know which doors a
      // process mounts. Real and Redis-backed over the same connection, and
      // never consulted here: this process mounts `workerClosedDoors()`.
      rateLimiter: redisRateLimiter(options.redis, WORKER_RATE_ALLOWANCE),
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
      projects: runtime.service(ProjectApi),
      organizations: runtime.service(OrganizationApi),
      authorization: runtime.service(AuthzApi),
      apiKeys: runtime.service(ApiKeyApi),
      shares: runtime.service(ShareApi),
      topics: runtime.service(TopicApi),
      close: () => runtime.stop(),
    },
    users: runtime.service(UserApi),
    auth: runtime.service(AuthApi),
    ops: runtime.service(OpsApi),
    auditLog: auditLog.auditLog(),
    retention: runtime.service(DataRetentionApi),
    close: () => runtime.stop(),
  };
}

/** The platform operators, as the comma-separated ADMIN_EMAILS this deployment named. */
function adminEmails(config: WorkerConfig): string[] {
  return (config.deployment.adminEmails ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}
