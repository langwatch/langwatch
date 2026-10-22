/**
 * The processor records a run's setup and teardown results off the child's result line, on a
 * passing run and on a failed one. The child is a real node script.
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ScenarioExecutionService } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";

const childScript = vi.hoisted(() => ({ current: "" }));
vi.mock("../../channels/scenario-child.spawn.channel.ts", () => ({
  ScenarioChildSpawn: {
    create: () => ({
      resolve: () => ({
        command: process.execPath,
        args: ["-e", childScript.current],
      }),
    }),
  },
}));

import type {
  CancellationSubscriber,
  ScenarioProcessorServiceMetrics,
} from "../../app/scenario.app.ts";
import { GoScenarioChildChannel } from "../../channels/scenario-child.go.channel.ts";
import {
  NodeScenarioChildChannel,
  type ScenarioChildProcessConfig,
} from "../../channels/scenario-child.node.channel.ts";
import { ScenarioChildChoiceService } from "../../features/child/services/scenario-child-choice.service.ts";
import { VoiceNonceRegistryService } from "../../features/voice/services/voice-nonce-registry.service.ts";
import { MemoryVoiceNonceRepository } from "../../repositories/memory/memory.voice-nonce.repository.ts";
import { ScenarioExecutionPoolService } from "../scenario-execution-pool.service.ts";
import type { ExecutionJobData } from "../scenario-execution-pool.service.ts";
import { ScenarioProcessorService } from "../scenario-processor.service.ts";

const JOB: ExecutionJobData = {
  projectId: "proj_hooks",
  scenarioId: "scen_hooks",
  setId: "set_hooks",
  batchRunId: "batch_hooks",
  scenarioRunId: "scenariorun_hooks",
  target: { type: "connected", referenceId: "agent_hooks" },
};

const HOOKS = {
  setup: { status: "ok", durationMs: 40, state: { orderId: "42" } },
  teardown: { status: "ok", durationMs: 30, state: { orderId: "42" }, returned: { deleted: 3 } },
};

class SilentCancellations implements CancellationSubscriber {
  subscribe(): Promise<() => Promise<void>> {
    return Promise.resolve(async () => {});
  }
}

class SilentMetrics implements ScenarioProcessorServiceMetrics {
  started(): void {}
  completed(): void {}
  failed(): void {}
}

/** A child that writes its result line last and exits with the given code. */
function childThatReports(result: Record<string, unknown>, exitCode = 0): string {
  return `
    process.stdin.resume();
    process.stdin.on("end", () => {
      console.log(${JSON.stringify(JSON.stringify(result))});
      process.exit(${exitCode});
    });
  `;
}

function buildProcessor() {
  const recordHooks = vi.fn().mockResolvedValue(undefined);
  const finishUnsuccessfulRun = vi.fn().mockResolvedValue(undefined);
  const execution = createApiFixture<ScenarioExecutionService>();
  execution.recordHooks = recordHooks;
  execution.finishUnsuccessfulRun = finishUnsuccessfulRun;
  execution.prepare = () =>
    ({
      childEnvironment: Promise.resolve({
        labels: [],
        telemetry: { endpoint: "http://localhost:9", apiKey: "test-key" },
      }),
      result: Promise.resolve({
        success: true,
        data: { scenario: { labels: [] } },
        telemetry: { endpoint: "http://localhost:9", apiKey: "test-key" },
        resolvedModels: null,
      }),
    }) as never;

  const config: ScenarioChildProcessConfig = {
    packageRoot: process.cwd(),
    sourcePath: `${process.cwd()}/src/scenario-child.entrypoint.ts`,
    sourceRoots: [`${process.cwd()}/src`],
    nodeEnv: "test",
    isSaas: false,
    egress: { blockLocal: false, allowedHosts: [] },
    parentEnvironment: { path: process.env.PATH ?? "/usr/bin", home: process.env.HOME ?? "/" },
  };
  const pool = ScenarioExecutionPoolService.create({ concurrency: 1 });
  const processor = ScenarioProcessorService.create({
    execution,
    pool,
    cancellations: new SilentCancellations(),
    childProcesses: ScenarioChildChoiceService.create({
      node: NodeScenarioChildChannel.create({ config }),
      go: GoScenarioChildChannel.create({ config, binaryPath: undefined }),
      featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => false }),
      pool,
      nonces: VoiceNonceRegistryService.create({ nonces: MemoryVoiceNonceRepository.create() }),
    }),
    metrics: new SilentMetrics(),
  });

  pool.connect(processor);

  return { pool, recordHooks, finishUnsuccessfulRun };
}

/** Waits for the pool to finish everything it is holding. */
async function drained(pool: ScenarioExecutionPoolService): Promise<void> {
  const deadline = Date.now() + 25_000;
  while (pool.inFlightJobs.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  // The close handler records after it deregisters, so give it its own tick.
  await new Promise((resolve) => setTimeout(resolve, 200));
}

describe("given a scenario child whose agent declared hooks", () => {
  beforeEach(() => {
    childScript.current = "";
  });

  describe("when the run passes and its result line names both hook results", () => {
    /** @scenario "The processor records hooks off the child's result line" */
    it("records both hooks on the run once the child exits", async () => {
      childScript.current = childThatReports({ success: true, hooks: HOOKS });
      const { pool, recordHooks, finishUnsuccessfulRun } = buildProcessor();

      pool.submit(JOB);
      await drained(pool);

      expect(recordHooks).toHaveBeenCalledWith({
        projectId: "proj_hooks",
        scenarioRunId: "scenariorun_hooks",
        hooks: HOOKS,
      });
      expect(finishUnsuccessfulRun).not.toHaveBeenCalled();
    }, 30_000);
  });

  describe("when setup failed and the child exits with an error and the hook results", () => {
    /**
     * @scenario "The processor records hooks off the child's result line"
     * @scenario "A run whose setup failed is not scored"
     */
    it("finishes the run not scored and still records both hooks", async () => {
      const hooks = {
        setup: { status: "failed", durationMs: 12, error: "no such customer" },
        teardown: { status: "ok", durationMs: 9 },
      };
      childScript.current = childThatReports(
        { success: false, error: "Scenario setup failed: no such customer", hooks },
        1,
      );
      const { pool, recordHooks, finishUnsuccessfulRun } = buildProcessor();

      pool.submit(JOB);
      await drained(pool);

      expect(finishUnsuccessfulRun).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Scenario setup failed: no such customer",
          notScored: true,
        }),
      );
      expect(recordHooks).toHaveBeenCalledWith({
        projectId: "proj_hooks",
        scenarioRunId: "scenariorun_hooks",
        hooks,
      });
    }, 30_000);
  });

  describe("when setup timed out and the child exits with an error and the hook results", () => {
    /** @scenario "A run whose setup timed out is not scored" */
    it("finishes the run not scored and records the timeout", async () => {
      const hooks = {
        setup: { status: "timed_out", durationMs: 60_000, error: "no answer within 60s" },
        teardown: { status: "ok", durationMs: 9 },
      };
      childScript.current = childThatReports(
        { success: false, error: "Scenario setup timed out: no answer within 60s", hooks },
        1,
      );
      const { pool, recordHooks, finishUnsuccessfulRun } = buildProcessor();

      pool.submit(JOB);
      await drained(pool);

      expect(finishUnsuccessfulRun).toHaveBeenCalledWith(
        expect.objectContaining({ notScored: true }),
      );
      expect(recordHooks).toHaveBeenCalledWith(expect.objectContaining({ hooks }));
    }, 30_000);
  });

  describe("when the turns failed after setup answered", () => {
    it("finishes the run scored, as any failed run", async () => {
      const hooks = {
        setup: { status: "ok", durationMs: 12, state: { orderId: "42" } },
        teardown: { status: "ok", durationMs: 9 },
      };
      childScript.current = childThatReports({ success: false, error: "agent crashed", hooks }, 1);
      const { pool, finishUnsuccessfulRun } = buildProcessor();

      pool.submit(JOB);
      await drained(pool);

      expect(finishUnsuccessfulRun).toHaveBeenCalledWith(
        expect.not.objectContaining({ notScored: true }),
      );
    }, 30_000);
  });

  describe("when keep data is asked for", () => {
    /** @scenario "Rerun and keep data skips teardown for that rerun" */
    it("hands keep data to the child", async () => {
      // The child echoes its job's keepData back as the teardown status it would record.
      childScript.current = `
        let input = "";
        process.stdin.on("data", (chunk) => { input += chunk; });
        process.stdin.on("end", () => {
          const job = JSON.parse(input);
          const status = job.keepData === true ? "skipped" : "ok";
          console.log(JSON.stringify({ success: true, hooks: { teardown: { status, durationMs: 0 } } }));
          process.exit(0);
        });
      `;
      const { pool, recordHooks } = buildProcessor();

      pool.submit({ ...JOB, keepData: true });
      await drained(pool);

      expect(recordHooks).toHaveBeenCalledWith(
        expect.objectContaining({ hooks: { teardown: { status: "skipped", durationMs: 0 } } }),
      );
    }, 30_000);
  });

  describe("when the result line names no hook result", () => {
    /** @scenario "A result line with no hook results records nothing" */
    it("records nothing", async () => {
      childScript.current = childThatReports({ success: true });
      const { pool, recordHooks } = buildProcessor();

      pool.submit(JOB);
      await drained(pool);

      expect(recordHooks).not.toHaveBeenCalled();
    }, 30_000);
  });
});
