import type { AgentApi } from "@langwatch/agent-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type * as observability from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SimulationService } from "@langwatch/scenario-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

const logWarn = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof observability>()),
  createLogger: () => ({ info: vi.fn(), warn: logWarn, error: vi.fn(), debug: vi.fn() }),
}));

import { MemoryScenarioCancellationRepository } from "../repositories/memory/memory.scenario-cancellation.repository.ts";
import { MemoryVoiceNonceRepository } from "../repositories/memory/memory.voice-nonce.repository.ts";
import type { ScenarioRunSecretSeal } from "../repositories/scenario.repository.ts";
import { ScenarioExecutionPoolService } from "../services/scenario-execution-pool.service.ts";
import { ScenarioExecutorService } from "../services/scenario-executor.service.ts";
import type { ScenarioService } from "../services/scenario.service.ts";
import { VoiceNonceRegistryService } from "../services/voice-nonce-registry.service.ts";
import {
  scenarioExecutorPeers,
  scenarioTestVoicePublicUrl,
  scenarioTestConfig,
} from "./support/scenario-app-setup.fixture.ts";

function harness({
  langwatchEndpoint,
  nlpServiceUrl,
}: {
  langwatchEndpoint: string | undefined;
  nlpServiceUrl: string | undefined;
}) {
  const channel = MemoryScenarioCancellationRepository.create();
  const owned: string[] = [];
  const executor = ScenarioExecutorService.create({
    voiceNonces: VoiceNonceRegistryService.create({ nonces: MemoryVoiceNonceRepository.create() }),
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
    runSecretSeal: createApiFixture<ScenarioRunSecretSeal>(),
    cancellations: channel,
    cancellationSubscriptions: channel,
    config: { ...scenarioTestConfig, langwatchEndpoint },
    host: {
      voicePublicUrl: scenarioTestVoicePublicUrl,
      nlpServiceUrl,
      nlpInternalSecret: void 0,
      isSaas: false,
      nodeEnvironment: "test",
      publicBaseUrl: void 0,
    },
  });
  const pool = ScenarioExecutionPoolService.create({ concurrency: 1 });
  executor.connect({ pool, resources: { own: (name) => void owned.push(name) } });
  return { channel, owned, pool };
}

describe("ScenarioExecutorService", () => {
  describe("given a telemetry endpoint and an NLP engine", () => {
    /** @scenario "A consuming worker connects the executor to its pool" */
    it("connects the pool's runner, subscribes to cancellations and owns the drain", async () => {
      const { channel, owned, pool } = harness({
        langwatchEndpoint: "https://collector.test",
        nlpServiceUrl: "http://nlp.test",
      });

      await channel.publish({ projectId: "project-1", scenarioRunId: "run-1" });

      expect(pool.wasCancelled("run-1")).toBe(true);
      expect(owned).toEqual(["scenario executor"]);
    });
  });

  describe("given no telemetry endpoint", () => {
    /** @scenario "A worker without a telemetry endpoint composes no executor" */
    it("connects nothing and owns nothing", async () => {
      const { channel, owned, pool } = harness({
        langwatchEndpoint: void 0,
        nlpServiceUrl: "http://nlp.test",
      });

      await channel.publish({ projectId: "project-1", scenarioRunId: "run-1" });

      expect(pool.wasCancelled("run-1")).toBe(false);
      expect(owned).toEqual([]);
    });
  });

  describe("given a worker missing one execution input", () => {
    /** @scenario "A worker missing one execution input composes no executor" */
    it.each([
      { missing: "no telemetry endpoint", reason: "no-telemetry-endpoint", endpoint: void 0 },
      { missing: "no NLP engine", reason: "no-nlp-engine", endpoint: "https://collector.test" },
    ])("composes none and names the input ($missing)", async ({ reason, endpoint }) => {
      logWarn.mockClear();
      const { channel, owned, pool } = harness({
        langwatchEndpoint: endpoint,
        nlpServiceUrl: void 0,
      });

      await channel.publish({ projectId: "project-1", scenarioRunId: "run-1" });

      expect(pool.wasCancelled("run-1")).toBe(false);
      expect(owned).toEqual([]);
      expect(logWarn).toHaveBeenCalledWith(
        { reason },
        expect.stringContaining("no scenario executor"),
      );
    });
  });
});
