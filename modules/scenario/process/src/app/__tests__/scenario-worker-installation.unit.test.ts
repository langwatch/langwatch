/**
 * @vitest-environment node
 * The scenario module installed on the worker role: the pipelines it hosts, over memory.
 */
import { EventEmitter } from "node:events";

import { type AgentApi, AgentNotFoundError } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { scenarioTestConfig } from "../../__tests__/support/scenario-app-setup.fixture.ts";
import { scenarioServer } from "../../scenario.server.ts";
import type { ScenarioReadOnlyClickHouse } from "../scenario.app.ts";

const projectId = "project-1";

function process(role: "api" | "worker", emitter: EventEmitter) {
  return createApp({ role })
    .withModules([withMemoryRepositories(scenarioServer)])
    .withConfig({ scenario: scenarioTestConfig })
    .withStores(memoryStores())
    .withAnalytical(createApiFixture<ScenarioReadOnlyClickHouse>())
    .withKeyvalue(memoryRedisDouble())
    .withMember("encryption", {
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    })
    .withMember("rateLimiter", { check: async () => ({ allowed: true }) })
    .withMember("idempotency", { claim: async () => true })
    .withMember("publicBaseUrl", "https://app.langwatch.test")
    .withMember("nlpServiceUrl", undefined)
    .withMember("nlpCodeBlockTimeoutSeconds", undefined)
    .withMember("isSaas", false)
    .withMember("nodeEnvironment", "test")
    .provide({
      agent: createApiFixture<AgentApi>({
        getById: async ({ id }) => {
          throw new AgentNotFoundError(id, projectId);
        },
      }),
      user: createApiFixture<UserApi>(),
      project: createApiFixture<ProjectApi>({
        findById: async () => null,
        getOrganizationId: async () => "organization-1",
      }),
      entitlement: createApiFixture<EntitlementApi>({ assertWithinUsageLimit: async () => {} }),
      "model-provider": createApiFixture<ModelProviderApi>(),
      presence: createApiFixture<PresenceApi>({
        getTenantEmitter: () => emitter,
        cleanupTenantEmitter: () => {},
      }),
      "audit-log": createApiFixture<AuditLogApi>(),
      trace: createApiFixture<TraceApi>(),
      billing: createApiFixture<BillingApi>(),
      "data-retention": createApiFixture<DataRetentionApi>(),
      suite: createApiFixture<SuiteApi>(),
      evaluation: createApiFixture<EvaluationApi>(),
      prompt: createApiFixture<PromptApi>(),
      secret: createApiFixture<SecretApi>(),
      workflow: createApiFixture<WorkflowApi>(),
      "feature-flag": createApiFixture<FeatureFlagApi>({ isEnabled: async () => false }),
    });
}

function eventingFor(role: "api" | "worker"): EventSourcing {
  const eventStore = EventStoreMemory.createForTesting();
  if (role === "api") {
    return new EventSourcing({
      eventStore,
      executionTarget: "api",
      consumersEnabled: false,
      processManagerMode: "producer-only",
    });
  }
  return new EventSourcing({
    eventStore,
    processStore: InMemoryProcessStore.createForTesting(),
    executionTarget: "worker",
    consumersEnabled: true,
  });
}

async function installedOn(role: "api" | "worker") {
  const eventing = eventingFor(role);
  const runtime = await process(role, new EventEmitter()).withEventing(eventing).boot();
  await runtime.stop();
  const keys = [...eventing.globalJobRegistry.keys()].filter((key) =>
    key.startsWith("simulation_processing:"),
  );
  return { keys, unrun: eventing.unrunProcessManagers, eventing };
}

const SIMULATION_KEYS = [
  "command:cancelRun",
  "command:computeRunMetrics",
  "command:deleteRun",
  "command:finishRun",
  "command:messageSnapshot",
  "command:queueRun",
  "command:recordAgentInstance",
  "command:recordEvaluations",
  "command:startRun",
  "command:textMessageEnd",
  "command:textMessageStart",
  "handler:simulationRunMetrics",
  "projection:simulationRunState",
  "subscriber:pm:scenario_evaluations",
  "subscriber:pm:simulation_run_execution",
  "subscriber:snapshotUpdateBroadcast",
  "subscriber:suiteRunSync",
  "subscriber:traceMetricsSync",
].map((key) => `simulation_processing:${key}`);

describe("given the scenario module installed on the worker role", () => {
  /** @scenario "The worker hosts every simulation processing routing key" */
  it("claims every simulation_processing key and nothing else under that pipeline", async () => {
    const { keys, eventing } = await installedOn("worker");

    expect(keys.toSorted()).toEqual(SIMULATION_KEYS);
    expect(eventing.getPipeline("simulation_processing")).toBeDefined();
  });

  /** @scenario "The worker hosts the subscriber that tells a tenant's tabs a run changed" */
  it("hosts the snapshot broadcast subscriber", async () => {
    const { keys } = await installedOn("worker");

    expect(keys).toContain("simulation_processing:subscriber:snapshotUpdateBroadcast");
  });

  /** @scenario "The worker hosts the subscriber that reports a run into its suite run" */
  it("hosts the suite run sync subscriber", async () => {
    const { keys } = await installedOn("worker");

    expect(keys).toContain("simulation_processing:subscriber:suiteRunSync");
  });

  /** @scenario "The worker runs the run-execution process manager itself" */
  it("leaves no simulation process manager unrun", async () => {
    const { unrun } = await installedOn("worker");

    expect(unrun).toEqual([]);
  });
});

describe("given the scenario module installed on the api role", () => {
  /** @scenario "The api registers the run-execution process manager without running it" */
  it("names the run-execution process manager among those it will not run", async () => {
    const { unrun } = await installedOn("api");

    expect(unrun).toContain("simulation_run_execution");
  });
});
