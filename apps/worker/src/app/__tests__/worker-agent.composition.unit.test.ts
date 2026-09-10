import { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { PrismaConnection } from "@langwatch/prisma-client";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { ResourceScope } from "@langwatch/runtime-composition";
import type { ScenarioApi, SimulationService } from "@langwatch/scenario-contract";
import { ScenarioExecutionPoolService, ScenarioProcessorService } from "@langwatch/scenario-server";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import type { NlpPayloadStagingPort } from "@langwatch/workflow-server";
import { describe, expect, it, vi } from "vitest";
import { resolveWorkerConfig } from "../../platform/config/worker.config.ts";
import { createWorkerAgentApps } from "../worker-agent-apps.composition.ts";
import type { WorkerFoundationApps } from "../worker-foundation-apps.composition.ts";
import { installWorkerAgent } from "../worker-agent.composition.ts";

function databaseFixture(): PrismaConnection {
  const client = new Proxy(
    {},
    {
      get() {
        throw new Error("Worker Agent installation must not query at boot.");
      },
    },
  );
  return PrismaConnection.create({ client: client as never, pool: client as never });
}

function peersFixture() {
  return {
    apiKeys: createApiFixture<ApiKeyApi>(),
    auditLog: createApiFixture<AuditLogApi>(),
    permissions: createApiFixture<AuthzApi>(),
    projects: createApiFixture<ProjectApi>(),
    scenarios: createApiFixture<ScenarioApi>(),
    traces: createApiFixture<TraceApi>(),
    users: createApiFixture<UserApi>(),
    workflows: createApiFixture<WorkflowApi>(),
  };
}

describe("installWorkerAgent", () => {
  it("starts the App's Redis subscriber only at start and releases it at stop", async () => {
    const subscribe = vi.fn<RedisConnection["subscribe"]>().mockResolvedValue(1);
    const unsubscribe = vi.fn<RedisConnection["unsubscribe"]>().mockResolvedValue(0);
    const quit = vi.fn<RedisConnection["quit"]>().mockResolvedValue("OK");
    const on = vi.fn<RedisConnection["on"]>();
    const subscriber = createApiFixture<RedisConnection>({ on, subscribe, unsubscribe, quit });
    on.mockReturnValue(subscriber);
    const duplicate = vi.fn<RedisConnection["duplicate"]>().mockReturnValue(subscriber);
    const redis = createApiFixture<RedisConnection>({ duplicate });
    const composition = await installWorkerAgent({
      connection: databaseFixture(),
      infrastructure: { redis },
      config: {
        publicBaseUrl: "https://langwatch.test",
        connected: { replicaCount: 2, relayMaxPayloadMb: void 0 },
      },
      peers: peersFixture(),
    });

    expect(composition.agents).toBe(composition.runtime.service(AgentApi));
    expect(duplicate).not.toHaveBeenCalled();

    await composition.runtime.start();
    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalled();

    await composition.runtime.stop();
    expect(unsubscribe).toHaveBeenCalled();
    expect(quit).toHaveBeenCalledTimes(1);
  });
});

describe("createWorkerAgentApps", () => {
  it("constructs the complete Agent, Scenario and Workflow graph without calling unready peers", async () => {
    const resources = new ResourceScope();
    const peers = peersFixture();
    const subscriber = createApiFixture<RedisConnection>();
    const redis = createApiFixture<RedisConnection>({ duplicate: () => subscriber });
    const config = resolveWorkerConfig({
      BASE_HOST: "https://langwatch.test",
      CREDENTIALS_SECRET: "0".repeat(64),
      LANGWATCH_NLP_SERVICE: "https://nlp.langwatch.test",
    });
    const graph = await createWorkerAgentApps({
      prerequisites: {
        config,
        connection: databaseFixture(),
        modelProviders: createApiFixture<ModelProviderApi>(),
        projects: peers.projects,
        redis,
        resolveClickHouseClient: async () => {
          throw new Error("No queries at boot.");
        },
        defaultRetentionDays: 30,
        langwatchEndpoint: "https://langwatch.test",
        nlpServiceUrl: "https://nlp.langwatch.test",
        encryptionKey: "0".repeat(64),
        payloadStaging: createApiFixture<NlpPayloadStagingPort>(),
      },
      foundation: createApiFixture<WorkerFoundationApps>({
        auditLog: peers.auditLog,
        users: peers.users,
        tenancy: createApiFixture<WorkerFoundationApps["tenancy"]>({
          projects: peers.projects,
          authorization: peers.permissions,
          apiKeys: peers.apiKeys,
        }),
      }),
      simulations: createApiFixture<SimulationService>(),
      pool: ScenarioExecutionPoolService.create({ concurrency: 1 }),
      resolveClickHouseClient: async () => {
        throw new Error("No queries at boot.");
      },
      resources,
      traces: createApiFixture<TraceApi>(),
    });

    expect(graph.processor).toBeInstanceOf(ScenarioProcessorService);
    await resources.close();
  });
});
