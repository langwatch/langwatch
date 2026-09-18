/**
 * ScenarioApp reads `publicBaseUrl` off the process's own member, the same
 * way SuiteApp does - see specs/scenarios/scenario-api.feature.
 * @vitest-environment node
 */
import { EventEmitter } from "node:events";

import type { AgentApi } from "@langwatch/agent-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { ResourceOwnership } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { Encryption } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  type ScenarioExecutionService,
  type ScenarioTabRegistry,
  type SimulationService,
} from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryScenarioRepositories } from "../../repositories/memory/memory.scenario.repositories.ts";
import type { AgentTestService } from "../../services/agent-test.service.ts";
import type { ResultAtomsService } from "../../services/result-atoms.service.ts";
import type { RunConfigurationsService } from "../../services/run-configurations.service.ts";
import { ScenarioApp } from "../scenario.app.ts";

function buildProductionApp(publicBaseUrl: string | undefined, emitter = new EventEmitter()) {
  return ScenarioApp.create({
    repositories: MemoryScenarioRepositories.create(),
    dependencies: {
      agents: createApiFixture<AgentApi>(),
      users: createApiFixture<UserApi>(),
      projects: createApiFixture<ProjectApi>(),
      plans: createApiFixture<EntitlementApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
      presence: createApiFixture<PresenceApi>(),
      auditLog: createApiFixture<AuditLogApi>(),
      traces: createApiFixture<TraceApi>(),
    },
    config: undefined,
    resources: createApiFixture<ResourceOwnership>(),
    secrets: {} as never,
    members: {
      publicBaseUrl,
      encryption: createApiFixture<Encryption>({
        encrypt: (value: string) => value,
        decrypt: (value: string) => value,
      }),
      agentTesting: createApiFixture<AgentTestService>(),
      simulations: createApiFixture<SimulationService>(),
      scenarioExecution: createApiFixture<ScenarioExecutionService>(),
      scenarioTabs: createApiFixture<ScenarioTabRegistry>(),
      broadcast: {
        getTenantEmitter: () => emitter,
        broadcastToTenant: async () => {},
        broadcastToTenantRateLimited: async () => {},
      },
      resultAtoms: createApiFixture<ResultAtomsService>(),
      runConfigurations: createApiFixture<RunConfigurationsService>(),
      rateLimiter: { check: async () => ({ allowed: true }) },
    },
  });
}

describe("ScenarioApp built the way production composes it", () => {
  describe("given a deployment that configured a public base URL", () => {
    /** @scenario "A scenario's platform link answers when a public base URL is configured" */
    it("answers a platform link instead of refusing by name", () => {
      const app = buildProductionApp("https://app.langwatch.test");

      expect(app.platformUrl({ projectSlug: "acme", path: "/scenarios/scenario_1" })).toBe(
        "https://app.langwatch.test/acme/scenarios/scenario_1",
      );
    });
  });

  describe("given a deployment that named no public base URL", () => {
    /** @scenario "A scenario's platform link refuses by name without a public base URL" */
    it("still refuses by name, as it did before this deployment had a config seam", () => {
      const app = buildProductionApp(undefined);

      expect(() => app.platformUrl({ projectSlug: "acme", path: "/scenarios/scenario_1" })).toThrow(
        /named no public base URL/,
      );
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
