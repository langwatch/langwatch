/**
 * The processor path a succeeded job takes, end to end on this side of the
 * child: the pool spawns the child, the child writes log lines and then its
 * result line on stdout and exits, and the parent reads the instance off that
 * line and records it on the run.
 *
 * The child is a real process — a small node script in place of the scenario
 * runner — so the stdout capture, the result-line parse and the close handler
 * are the ones the worker runs.
 *
 * @see specs/scenarios/served-agent-instance-on-runs.feature
 */
import { ScenarioExecutionService } from "@langwatch/scenario-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

const childScript = vi.hoisted(() => ({ current: "" }));
vi.mock("../../adapters/child-process-spawn.adapter", () => ({
  resolveChildProcessSpawn: () => ({
    command: process.execPath,
    args: ["-e", childScript.current],
  }),
}));

import { NodeScenarioChildProcessAdapter } from "../../adapters/node-scenario-child-process.adapter";
import { CancellationSubscriberPort } from "../../ports/cancellation-channel.port";
import { ScenarioProcessorServiceMetricsPort } from "../../ports/scenario-processor-metrics.port";
import { ScenarioExecutionPoolService } from "../scenario-execution-pool.service";
import type { ExecutionJobData } from "../scenario-execution-pool.service";
import { ScenarioProcessorService } from "../scenario-processor.service";

const JOB: ExecutionJobData = {
  projectId: "proj_served",
  scenarioId: "scen_served",
  setId: "set_served",
  batchRunId: "batch_served",
  scenarioRunId: "scenariorun_served",
  target: { type: "connected", referenceId: "agent_served" },
};

class SilentCancellations extends CancellationSubscriberPort {
  subscribe(): Promise<() => Promise<void>> {
    return Promise.resolve(async () => {});
  }
}

class SilentMetrics extends ScenarioProcessorServiceMetricsPort {
  started(): void {}
  completed(): void {}
  failed(): void {}
}

/** A child that logs the way the runner does, writes its result line last, and exits. */
function childThatReports(result: Record<string, unknown>): string {
  return `
    process.stdin.resume();
    process.stdin.on("end", () => {
      console.log("[child] scenario passed");
      console.log(${JSON.stringify(JSON.stringify(result))});
      process.exit(0);
    });
  `;
}

function buildProcessor() {
  const recordAgentInstance = vi.fn().mockResolvedValue(undefined);
  const finishUnsuccessfulRun = vi.fn().mockResolvedValue(undefined);
  const execution = Object.create(ScenarioExecutionService.prototype) as ScenarioExecutionService;
  execution.recordAgentInstance = recordAgentInstance;
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

  const pool = ScenarioExecutionPoolService.create({ concurrency: 1 });
  const processor = ScenarioProcessorService.create({
    execution,
    pool,
    cancellations: new SilentCancellations(),
    childProcesses: NodeScenarioChildProcessAdapter.create({
      pool,
      config: {
        packageRoot: process.cwd(),
        sourcePath: `${process.cwd()}/src/scenario-child.entrypoint.ts`,
        sourceRoots: [`${process.cwd()}/src`],
        nodeEnv: "test",
        isSaas: false,
        egress: { blockLocal: false, allowedHosts: [] },
        parentEnvironment: { path: process.env.PATH ?? "/usr/bin", home: process.env.HOME ?? "/" },
      },
    }),
    metrics: new SilentMetrics(),
  });

  pool.connect(processor);

  return { processor, pool, recordAgentInstance, finishUnsuccessfulRun };
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

describe("given a scenario child that runs to the end", () => {
  beforeEach(() => {
    childScript.current = "";
  });

  describe("when its result line names the instance that served it", () => {
    /** @scenario The processor records the instance off the child's result line */
    it("records that instance on the run once the child exits", async () => {
      childScript.current = childThatReports({
        success: true,
        reasoning: "All criteria met",
        agentInstance: { hostname: "worker-1", label: "blue" },
      });
      const { pool, recordAgentInstance, finishUnsuccessfulRun } = buildProcessor();

      pool.submit(JOB);
      await drained(pool);

      expect(recordAgentInstance).toHaveBeenCalledWith({
        projectId: "proj_served",
        scenarioRunId: "scenariorun_served",
        agentInstance: { hostname: "worker-1", label: "blue" },
      });
      expect(finishUnsuccessfulRun).not.toHaveBeenCalled();
    }, 30_000);
  });

  describe("when its result line names no instance", () => {
    /** @scenario The processor records the instance off the child's result line */
    it("records nothing", async () => {
      childScript.current = childThatReports({ success: true });
      const { pool, recordAgentInstance, finishUnsuccessfulRun } = buildProcessor();

      pool.submit(JOB);
      await drained(pool);

      expect(recordAgentInstance).not.toHaveBeenCalled();
      expect(finishUnsuccessfulRun).not.toHaveBeenCalled();
    }, 30_000);
  });
});
