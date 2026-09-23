/**
 * @vitest-environment node
 * The feature installs: a process booting it over memory gets a working
 * `OpsApi`, the instance the runtime hands back, in either role.
 */
import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type { AnnotationApi } from "@langwatch/annotation-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AutomationApi } from "@langwatch/automation-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { DashboardApi } from "@langwatch/dashboard-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { GithubApi } from "@langwatch/github-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type { LangyApi } from "@langwatch/langy-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { NotificationService as NotificationApi } from "@langwatch/notification-contract";
import { OpsApi } from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createTestLogger } from "@langwatch/test-harness";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { opsServer } from "../../ops.server.ts";
import { SNAPSHOT_LEASE_KEY } from "../../repositories/redis/redis.ops-snapshot.repository.ts";
import { OPS_STAFF_ADDRESS } from "./ops.fixture.ts";

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

function process(role: "api" | "worker", redisCommands: unknown[][] = []) {
  const { logger } = createTestLogger();

  return createApp({ role })
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
      },
    })
    .withMember("nodeEnvironment", undefined)
    .withMember("adminEmails", [OPS_STAFF_ADDRESS])
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
      identity: createApiFixture<IdentityApi>(),
      project: createApiFixture<ProjectApi>({ searchByQuery: async () => [] }),
      "audit-log": createApiFixture<AuditLogApi>({ record: async () => {} }),
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
      automation: createApiFixture<AutomationApi>(),
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
        expect(app.operatorScope({ id: "user_alex", email: OPS_STAFF_ADDRESS })).toEqual({
          kind: "platform",
        });
        expect(app.operatorScope({ id: "user_sam", email: "sam@acme.com" })).toEqual({
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

        await expect(
          app.getBugReport({ id: filed.id, actorUserId: "user_alex" }),
        ).resolves.toMatchObject({ title: "The CLI could not reach the API" });
      } finally {
        await runtime.stop();
      }
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
});
