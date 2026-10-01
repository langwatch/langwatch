/**
 * @vitest-environment node
 * The feature installs: a process booting it over memory gets a working
 * `OpsApi`, the instance the runtime hands back, in either role.
 */
import { generateKeyPairSync } from "node:crypto";

import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { AutomationApi } from "@langwatch/automation-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { DashboardApi } from "@langwatch/dashboard-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { GithubApi } from "@langwatch/github-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import type { LangyApi } from "@langwatch/langy-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { NotificationService as NotificationApi } from "@langwatch/notification-contract";
import { OpsApi } from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApp, withMemoryRepositories } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import type { SystemMigration } from "@langwatch/system-migrations";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { opsServer } from "../../ops.server.ts";
import { PrismaSystemMigrationStateRepository } from "../../repositories/prisma/prisma.system-migration-state.repository.ts";
import { SNAPSHOT_LEASE_KEY } from "../../repositories/redis/redis.ops-snapshot.repository.ts";
import { OPS_STAFF_ADDRESS, platformOperatorAuthz } from "./ops.fixture.ts";

/** A store that holds nothing: every command is written down, a lease `SET` is granted. */
function memberWithoutStore<Value extends object>(commands: unknown[][] = []): Value {
  const member: Partial<Value> = {};
  return new Proxy(member, {
    get:
      (_member, command) =>
      async (...args: unknown[]) => {
        commands.push([command, ...args]);
        return command === "set" ? "OK" : null;
      },
  }) as Value;
}

function process(
  role: "api" | "worker",
  redisCommands: unknown[][] = [],
  identity: IdentityApi = createApiFixture<IdentityApi>(),
  authz: AuthzApi = platformOperatorAuthz({ holders: { user_alex: ["ops:view", "ops:manage"] } }),
  cloud: { asked?: boolean; privateKey?: string } = {},
) {
  const { logger } = createTestLogger();

  return createApp({
    role,
    secrets: () =>
      new ScopedSecrets(async (handle, build) =>
        build(handle.id === "LANGWATCH_LICENSE_PRIVATE_KEY" ? cloud.privateKey : void 0),
      ),
  })
    .withModules([withMemoryRepositories(opsServer)])
    .withConfig({
      ops: {
        apiKey: undefined,
        metricsApiKey: undefined,
        clickhouseOpsUrl: undefined,
        usageStats: {
          disabled: false,
          installMethod: undefined,
          chartVersion: undefined,
        },
        collectClickHouseBackupMetrics: true,
        productAnalytics: { key: undefined, host: undefined },
        cloudOps: cloud.asked ?? false,
        adminEmails: [],
      },
    })

    .withMember("nodeEnvironment", undefined)
    .withMember("isSaas", false)
    .withMember("serviceVersion", "test")
    .withMember("publicBaseUrl", undefined)
    .withMember("processName", "langwatch-test")
    .withRelational(new PrismaClient({ accelerateUrl: "prisma://localhost/test" }))
    .withAnalytical(memberWithoutStore<ClickHouseQueryClient>())
    .withKeyvalue(memberWithoutStore<RedisConnection>(redisCommands))
    .withEventing(
      new EventSourcing({ enabled: false, processStore: InMemoryProcessStore.createForTesting() }),
    )
    .withObservability((observability) => observability.withLogging(logger))
    .provide({
      user: createApiFixture<UserApi>(),
      auth: createApiFixture<AuthApi>(),
      identity,
      authz,
      "data-retention": createApiFixture<DataRetentionApi>(),
      project: createApiFixture<ProjectApi>({ searchByQuery: async () => [] }),
      "audit-log": createApiFixture<AuditLogApi>({
        record: async () => ({ id: "audit", occurredAt: 0 }),
      }),
      "api-key": createApiFixture<ApiKeyApi>({ findResolvedToken: async () => null }),
      "feature-flag": createApiFixture<FeatureFlagApi>(),
      organization: createApiFixture<OrganizationApi>(),
      licensing: createApiFixture<LicensingApi>(),
      "model-provider": createApiFixture<ModelProviderApi>(),
      dataset: createApiFixture<DatasetApi>(),
      annotation: createApiFixture<AnnotationApi>(),
      monitor: createApiFixture<MonitorApi>(),
      experiment: createApiFixture<ExperimentApi>(),
      prompt: createApiFixture<PromptApi>(),
      workflow: createApiFixture<WorkflowApi>(),
      automation: createApiFixture<AutomationApi>({ registeredMigrations: () => [] }),
      github: createApiFixture<GithubApi>(),
      langy: createApiFixture<LangyApi>(),
      dashboard: createApiFixture<DashboardApi>(),
      trace: createApiFixture<TraceApi>(),
      scenario: createApiFixture<ScenarioApi>(),
      gateway: createApiFixture<GatewayApi>(),
      "instant-eval": createApiFixture<InstantEvalApi>(),
      "coding-agent": createApiFixture<CodingAgentApi>(),
      notification: createApiFixture<NotificationApi>(),
      "stored-object": createApiFixture<StoredObjectApi>(),
      analytics: createApiFixture<AnalyticsApi>(),
    });
}

describe("ops app installation", () => {
  describe("given a process that boots the feature over memory", () => {
    it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
      const runtime = await process(role).boot();

      try {
        const app = runtime.service(OpsApi);

        expect(runtime.module(opsServer).provided).toBe(app);
        expect(await app.operatorScope({ id: "user_alex", email: OPS_STAFF_ADDRESS })).toEqual({
          kind: "platform",
        });
        expect(await app.operatorScope({ id: "user_sam", email: "sam@acme.com" })).toEqual({
          kind: "none",
        });

        const filed = await app.submitBugReport({
          callerKey: "test-caller",
          report: {
            source: "cli",
            kind: "summary",
            title: "The CLI could not reach the API",
            summary: "It refused the key I had just minted.",
          },
        });

        expect(filed.id).toEqual(expect.any(String));
        // Intake answers everywhere; the inbox is Cloud admin, and this install has cloud-ops off.
        await expect(
          app.getBugReport({ id: filed.id, actorUserId: "user_alex" }),
        ).rejects.toMatchObject({ code: "not_found" });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("given the deployment asks for Cloud admin (LANGWATCH_CLOUD_OPS)", () => {
    /** @scenario "Asking for Cloud admin without a matching licence key refuses boot" */
    it("refuses boot with the key mismatch code when no licence private key is held", async () => {
      await expect(
        process("api", [], void 0, void 0, { asked: true }).boot(),
      ).rejects.toMatchObject({ code: "cloud_ops_key_mismatch" });
    });

    /** @scenario "Asking for Cloud admin without a matching licence key refuses boot" */
    it("refuses boot when the key is not the pair of the release's public key", async () => {
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const other = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

      await expect(
        process("api", [], void 0, void 0, { asked: true, privateKey: other }).boot(),
      ).rejects.toMatchObject({ code: "cloud_ops_key_mismatch" });
    });
  });

  describe("given the process starts", () => {
    /** @scenario "The queue-metrics writer contends for the lease in every serving role" */
    it.each(["api", "worker"] as const)(
      "the %s role runs the queue-metrics writer and hands its lease back on stop",
      async (role) => {
        const redisCommands: unknown[][] = [];
        const runtime = await process(role, redisCommands).boot();
        const leaseCommands = () =>
          redisCommands.filter((command) => command.includes(SNAPSHOT_LEASE_KEY));

        try {
          expect(leaseCommands()).toEqual([]);
          await runtime.start();

          await vi.waitFor(() =>
            expect(leaseCommands()).toContainEqual(expect.arrayContaining(["set"])),
          );
        } finally {
          await runtime.stop();
        }

        expect(leaseCommands().at(-1)?.[0]).toBe("eval");
      },
    );
  });

  describe("given the api role and a peer that registers migrations", () => {
    const migration = (name: string, title: string): SystemMigration => ({
      name,
      title,
      description: `${title}, as its owner describes it.`,
      requiresOperatorConfirmation: false,
      runsAutomaticallyOnSelfHosted: true,
      enrolledAutomatically: false,
      migrateTenant: async () => ({ status: "finalized" }),
    });
    const identity = createApiFixture<IdentityApi>({
      registeredMigrations: () => [migration("sso-domain-ownership", "Domain ownership")],
      userMigrations: () => [migration("identity-identifier-backfill", "Sign-in identifiers")],
    });
    const authz = createApiFixture<AuthzApi>({
      registeredMigrations: () => [migration("authz-grants-genesis-import", "Grant import")],
    });

    /** @scenario "The migrations page lists every registered migration when served by the api role" */
    /** @scenario "A migration registered by a peer module appears on the page with its title and description" */
    it("lists each peer's migrations, in running order, with the owner's title and description", async () => {
      vi.spyOn(
        PrismaSystemMigrationStateRepository.prototype,
        "findStatusCounts",
      ).mockResolvedValue({ migrated: 0, finalized: 3, parked: 0, rolled_back: 0 });
      vi.spyOn(
        PrismaSystemMigrationStateRepository.prototype,
        "findRecordsByStatus",
      ).mockResolvedValue([]);
      const runtime = await process("api", [], identity, authz).boot();

      try {
        const listed = await runtime.service(OpsApi).listSystemMigrations();

        expect(
          listed.map(({ name, title, description }) => ({ name, title, description })),
        ).toEqual([
          {
            name: "authz-grants-genesis-import",
            title: "Grant import",
            description: "Grant import, as its owner describes it.",
          },
          {
            name: "sso-domain-ownership",
            title: "Domain ownership",
            description: "Domain ownership, as its owner describes it.",
          },
          {
            name: "identity-identifier-backfill",
            title: "Sign-in identifiers",
            description: "Sign-in identifiers, as its owner describes it.",
          },
        ]);
        expect(listed[1]?.counts.finalized).toBe(3);
      } finally {
        vi.restoreAllMocks();
        await runtime.stop();
      }
    });
  });
});
