/**
 * ScenarioApp reads `publicBaseUrl` off the process's own member, the same
 * way SuiteApp does - see specs/scenarios/scenario-api.feature.
 * @vitest-environment node
 */
import { EventEmitter } from "node:events";

import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ResourceOwnership } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { Encryption } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import { type SimulationService } from "@langwatch/scenario-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import {
  scenarioExecutorPeers,
  scenarioHostMembers,
  scenarioTestConfig,
} from "../../__tests__/support/scenario-app-setup.fixture.ts";
import type { ScenarioEventBroadcastPublisher } from "../../channels/redis/redis.scenario-event-broadcast.channel.ts";
import { MemoryScenarioRepositories } from "../../repositories/memory/memory.scenario.repositories.ts";
import { ScenarioApp, type ScenarioReadOnlyClickHouse } from "../scenario.app.ts";

function buildProductionApp(publicBaseUrl: string | undefined, emitter = new EventEmitter()) {
  return ScenarioApp.create({
    repositories: MemoryScenarioRepositories.create(),
    dependencies: {
      agents: createApiFixture<AgentApi>(),
      evaluations: createApiFixture<EvaluationApi>(),
      users: createApiFixture<UserApi>(),
      projects: createApiFixture<ProjectApi>(),
      plans: createApiFixture<EntitlementApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
      presence: createApiFixture<PresenceApi>({
        getTenantEmitter: () => emitter,
        cleanupTenantEmitter: () => {},
      }),
      auditLog: createApiFixture<AuditLogApi>(),
      traces: createApiFixture<TraceApi>(),
      billing: createApiFixture<BillingApi>(),
      retention: createApiFixture<DataRetentionApi>(),
      suites: createApiFixture<SuiteApi>(),
      ...scenarioExecutorPeers(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
    },
    config: scenarioTestConfig,
    resources: createApiFixture<ResourceOwnership>(),
    secrets: {} as never,
    members: {
      ...scenarioHostMembers,
      redis: createApiFixture<ScenarioEventBroadcastPublisher>(),
      publicBaseUrl,
      encryption: createApiFixture<Encryption>({
        encrypt: (value: string) => value,
        decrypt: (value: string) => value,
      }),
      clickhouse: createApiFixture<ScenarioReadOnlyClickHouse>(),
      simulations: createApiFixture<SimulationService>(),
      rateLimiter: { check: async () => ({ allowed: true }) },
      idempotency: { claim: async () => true },
    },
  });
}

describe("ScenarioApp built the way production composes it", () => {
  describe("given a deployment that configured a public base URL", () => {
    /** @scenario "A scenario's platform link answers when a public base URL is configured" */
    it("answers a platform link instead of refusing by name", async () => {
      const app = buildProductionApp("https://app.langwatch.test");

      await expect(
        app.platformUrl({
          projectId: "project_1",
          projectSlug: "acme",
          resource: { scenarioId: "scenario_1" },
        }),
      ).resolves.toBe(
        "https://app.langwatch.test/acme/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=scenario_1",
      );
    });
  });

  describe("given no browser tab is open on the project's simulations", () => {
    /** @scenario "A browser-tab offer with no open tab answers undelivered with the run's link" */
    it("answers undelivered with the batch run's link", async () => {
      const app = buildProductionApp("https://app.langwatch.test");

      const offer = await app.offerScenarioBrowserTab({
        projectId: "project_1",
        projectSlug: "acme",
        tabKey: "tab_1",
        batchRunId: "batch_1",
      });

      expect(offer.delivered).toBe(false);
      expect(offer.url).toContain("batch_1");
    });
  });

  describe("given a deployment that named no public base URL", () => {
    /** @scenario "A scenario's platform link refuses by name without a public base URL" */
    it("still refuses by name, as it did before this deployment had a config seam", async () => {
      const app = buildProductionApp(undefined);

      await expect(
        app.platformUrl({
          projectId: "project_1",
          projectSlug: "acme",
          resource: { scenarioId: "scenario_1" },
        }),
      ).rejects.toThrow(/named no public base URL/);
    });
  });
});

describe("given a subscriber watching simulation updates", () => {
  /** @scenario "Simulation updates release tenant listeners when the stream aborts" */
  it("delivers the original frame and releases the listener on disconnect", async () => {
    const emitter = new EventEmitter();
    const app = buildProductionApp(undefined, emitter);
    const controller = new AbortController();
    const updates = app
      .simulationUpdates({
        projectId: "project-1",
        signal: controller.signal,
      })
      [Symbol.asyncIterator]();
    const pending = updates.next();
    const frame = { event: JSON.stringify({ scenarioRunId: "run-1" }), timestamp: 1234 };

    emitter.emit("simulation_updated", frame);
    await expect(pending).resolves.toEqual({ value: frame, done: false });

    controller.abort();
    await expect(updates.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(emitter.listenerCount("simulation_updated")).toBe(0);
  });
});
