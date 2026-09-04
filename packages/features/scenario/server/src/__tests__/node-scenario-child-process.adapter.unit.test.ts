/**
 * @vitest-environment node
 *
 * @see specs/scenarios/pre-compiled-child-process.feature
 */
import { ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcessJobData } from "@langwatch/scenario-contract";

vi.mock("../adapters/child-process-spawn.adapter", () => ({
  resolveChildProcessSpawn: () => ({ command: "node", args: ["/dist/bundle.cjs"] }),
}));

const stdinWrite = vi.fn();
const stdinEnd = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as unknown as ChildProcess;
    Object.assign(child, {
      pid: 123,
      stdin: { write: stdinWrite, end: stdinEnd, on: vi.fn() },
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    return child;
  }),
}));

import { NodeScenarioChildProcessAdapter } from "../adapters/node-scenario-child-process.adapter";
import { ScenarioExecutionPoolService, ScenarioExecutionRunnerPort } from "../index";
import type { ExecutionJobData } from "../services/scenario-execution-pool.service";

/** A runner that never actually executes — the pool only needs the job
 * marked active so `registerChild` below finds it. */
class NoopRunner extends ScenarioExecutionRunnerPort {
  async execute(): Promise<void> {}
  skipCancelled(): void {}
}

function job(): ExecutionJobData {
  return {
    projectId: "proj-1",
    scenarioId: "scen-1",
    scenarioRunId: "run-1",
    batchRunId: "batch-1",
    setId: "set-1",
    target: { type: "http", referenceId: "agent-1" },
  };
}

const jobData = {
  context: { projectId: "proj-1", scenarioId: "scen-1", setId: "set-1", batchRunId: "batch-1" },
  scenario: { id: "scen-1", name: "Test", situation: "Ask", criteria: [], labels: [] },
  adapterData: { type: "http", agentId: "agent-1", url: "https://x.test", method: "POST", headers: [], secrets: {} },
  nlpServiceUrl: "http://langwatch_nlp:5561",
  target: { type: "http", referenceId: "agent-1" },
  parameters: {},
} as unknown as ChildProcessJobData;

describe("NodeScenarioChildProcessAdapter", () => {
  beforeEach(() => {
    stdinWrite.mockClear();
    stdinEnd.mockClear();
  });

  describe("given a child process spawned from the pre-compiled bundle", () => {
    /** @scenario "Child process receives job data via stdin" */
    it("writes the job data to the child's stdin as JSON", () => {
      const adapter = NodeScenarioChildProcessAdapter.create({
        config: {
          packageRoot: "/app",
          sourcePath: "/app/src/adapter.ts",
          sourceRoots: ["/app/src"],
          nodeEnv: "production",
          isSaas: true,
          egress: { blockLocal: true, allowedHosts: [] },
          parentEnvironment: {},
        },
        pool: (() => {
          const pool = ScenarioExecutionPoolService.create({ concurrency: 1 });
          pool.connect(new NoopRunner());
          pool.submit(job());
          return pool;
        })(),
      });

      const session = adapter.start({
        jobData: job(),
        environment: { labels: [], telemetry: { endpoint: "https://x.test", apiKey: "key" } },
      });
      session.execute(jobData);

      expect(stdinWrite).toHaveBeenCalledWith(JSON.stringify(jobData));
      expect(stdinEnd).toHaveBeenCalled();
    });
  });
});
