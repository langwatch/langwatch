import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 * The feature installs: a process booting it over memory gets a working
 * `OpsApi`, the instance the runtime hands back, in either role.
 */
import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthApi } from "@langwatch/auth-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { EventSourcing } from "@langwatch/eventing";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { IdentityApi } from "@langwatch/identity-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import { OpsApi } from "@langwatch/ops-contract";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { createTestLogger } from "@langwatch/test-harness";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { opsServer } from "../../ops.server.ts";
import { OPS_STAFF_ADDRESS } from "./ops.fixture.ts";

function memberWithoutStore<Value extends object>(): Value {
  const member: Partial<Value> = {};
  return new Proxy(member, { get: () => async () => null }) as Value;
}

function process(role: "api" | "worker") {
  const { logger } = createTestLogger();

  return createApp({ role })
    .withModules([withMemoryRepositories(opsServer)])
    .withConfig({
      ops: {
        apiKey: undefined,
        metricsApiKey: undefined,
        clickhouseOpsUrl: undefined,
        usageStats: { disabled: false, installMethod: undefined },
        collectClickHouseBackupMetrics: true,
        productAnalytics: { key: undefined, host: undefined },
      },
    })
    .withMember("nodeEnvironment", undefined)
    .withMember("adminEmails", [OPS_STAFF_ADDRESS])
    .withRelational(new PrismaClient({ accelerateUrl: "prisma://localhost/test" }))
    .withAnalytical(memberWithoutStore<ClickHouseQueryClient>())
    .withKeyvalue(memberWithoutStore<RedisConnection>())
    .withEventing(new EventSourcing({ enabled: false }))
    .withObservability((observability) => observability.withLogging(logger))
    .provide({
      user: createApiFixture<UserApi>(),
      auth: createApiFixture<AuthApi>(),
      identity: createApiFixture<IdentityApi>(),
      project: createApiFixture<ProjectApi>({ searchByQuery: async () => [] }),
      "audit-log": createApiFixture<AuditLogApi>({ record: async () => {} }),
      "api-key": createApiFixture<ApiKeyApi>({ findResolvedToken: async () => null }),
      "feature-flag": createApiFixture<FeatureFlagApi>(),
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
});
