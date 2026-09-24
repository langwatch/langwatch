import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SimulationService } from "@langwatch/scenario-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import type { ScenarioSecretCipher } from "../app/scenario.app.ts";
import { MemoryCancellationChannelRepository } from "../repositories/memory/memory.cancellation-channel.repository.ts";
import { ScenarioExecutionPoolService } from "../services/scenario-execution-pool.service.ts";
import { ScenarioExecutorService } from "../services/scenario-executor.service.ts";
import type { ScenarioService } from "../services/scenario.service.ts";
import {
  scenarioExecutorPeers,
  scenarioHostMembers,
  scenarioTestConfig,
} from "./support/scenario-app-setup.fixture.ts";

function harness({ langwatchEndpoint }: { langwatchEndpoint: string | undefined }) {
  const channel = MemoryCancellationChannelRepository.create();
  const owned: string[] = [];
  const executor = ScenarioExecutorService.create({
    peers: {
      ...scenarioExecutorPeers(),
      agents: createApiFixture<AgentApi>(),
      suites: createApiFixture<SuiteApi>(),
      traces: createApiFixture<TraceApi>(),
      projects: createApiFixture<ProjectApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
    },
    scenarios: createApiFixture<ScenarioService>(),
    simulations: createApiFixture<SimulationService>(),
    secretCipher: createApiFixture<ScenarioSecretCipher>(),
    cancellations: channel,
    cancellationSubscriptions: channel,
    config: { ...scenarioTestConfig, langwatchEndpoint },
    host: { ...scenarioHostMembers, nlpServiceUrl: "http://nlp.test", publicBaseUrl: void 0 },
  });
  const pool = ScenarioExecutionPoolService.create({ concurrency: 1 });
  executor.connect({ pool, resources: { own: (name) => void owned.push(name) } });
  return { channel, owned, pool };
}

describe("ScenarioExecutorService", () => {
  describe("given a telemetry endpoint and an NLP engine", () => {
    /** @scenario "A consuming worker connects the executor to its pool" */
    it("connects the pool's runner, subscribes to cancellations and owns the drain", async () => {
      const { channel, owned, pool } = harness({ langwatchEndpoint: "https://collector.test" });

      await channel.publish({ projectId: "project-1", scenarioRunId: "run-1" });

      expect(pool.wasCancelled("run-1")).toBe(true);
      expect(owned).toEqual(["scenario executor"]);
    });
  });

  describe("given no telemetry endpoint", () => {
    /** @scenario "A worker without a telemetry endpoint composes no executor" */
    it("connects nothing and owns nothing", async () => {
      const { channel, owned, pool } = harness({ langwatchEndpoint: void 0 });

      await channel.publish({ projectId: "project-1", scenarioRunId: "run-1" });

      expect(pool.wasCancelled("run-1")).toBe(false);
      expect(owned).toEqual([]);
    });
  });
});
