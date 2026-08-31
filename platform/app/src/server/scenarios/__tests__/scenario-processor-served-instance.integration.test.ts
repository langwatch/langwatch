/**
 * The processor path a succeeded job takes, end to end on this side of the
 * child: the pool spawns the child, the child writes its result line on
 * stdout and exits, the parent reads the instance off the line and records
 * it on the run.
 *
 * The child is a real process, a small node script in place of the scenario
 * runner, so the stdout capture, the result-line parse and the close handler
 * are the ones the worker runs.
 *
 * @see specs/scenarios/served-agent-instance-on-runs.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const childScript = vi.hoisted(() => ({ current: "" }));

vi.mock("../execution/child-process-spawn", () => ({
  resolveChildProcessSpawn: () => ({
    command: process.execPath,
    args: ["-e", childScript.current],
  }),
}));

vi.mock("../execution/data-prefetcher", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../execution/data-prefetcher")>();
  return {
    ...actual,
    prefetchScenarioData: async () => ({
      success: true,
      data: { scenario: { labels: [] } },
      telemetry: { endpoint: "http://localhost:9", apiKey: "test-key" },
      resolvedModels: {},
    }),
  };
});

import type { ExecutionJobData } from "../execution/execution-pool";
import { ScenarioExecutionPool } from "../execution/execution-pool";
import type { ProcessorDependencies } from "../scenario.processor";
import { executeScenarioRun } from "../scenario.processor";

const JOB: ExecutionJobData = {
  projectId: "proj_served",
  scenarioId: "scen_served",
  setId: "set_served",
  batchRunId: "batch_served",
  scenarioRunId: "scenariorun_served",
  target: { type: "connected", referenceId: "agent_served" },
};

/**
 * A child that reads its stdin, logs like the runner does, then writes the
 * result line last and exits.
 */
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

describe("executeScenarioRun with a child that ran to the end", () => {
  let deps: ProcessorDependencies;
  let recordAgentInstance: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    recordAgentInstance = vi.fn().mockResolvedValue(undefined);
    deps = {
      scenarioLookup: { getById: vi.fn().mockResolvedValue(null) },
      failureEmitter: {
        ensureFailureEventsEmitted: vi.fn().mockResolvedValue(undefined),
      },
      agentInstanceRecorder: {
        recordAgentInstance:
          recordAgentInstance as ProcessorDependencies["agentInstanceRecorder"]["recordAgentInstance"],
      },
    };
  });

  describe("when the child's result line names the instance that served it", () => {
    /** @scenario "The processor records the instance off the child's result line" */
    it("records the instance on the run once the child exits", async () => {
      childScript.current = childThatReports({
        success: true,
        reasoning: "All criteria met",
        agentInstance: { hostname: "worker-1", label: "blue" },
      });
      const pool = new ScenarioExecutionPool({ concurrency: 1 });

      await executeScenarioRun(JOB, pool, deps);

      expect(recordAgentInstance).toHaveBeenCalledWith({
        projectId: "proj_served",
        scenarioRunId: "scenariorun_served",
        agentInstance: { hostname: "worker-1", label: "blue" },
      });
      expect(
        deps.failureEmitter.ensureFailureEventsEmitted,
      ).not.toHaveBeenCalled();
    }, 30_000);
  });

  describe("when the child's result line names no instance", () => {
    /** @scenario "The processor records the instance off the child's result line" */
    it("records nothing", async () => {
      childScript.current = childThatReports({ success: true });
      const pool = new ScenarioExecutionPool({ concurrency: 1 });

      await executeScenarioRun(JOB, pool, deps);

      expect(recordAgentInstance).not.toHaveBeenCalled();
      expect(
        deps.failureEmitter.ensureFailureEventsEmitted,
      ).not.toHaveBeenCalled();
    }, 30_000);
  });
});
