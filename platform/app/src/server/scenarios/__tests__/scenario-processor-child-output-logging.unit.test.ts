/**
 * @vitest-environment node
 *
 * The scenario runner's own output is CUSTOMER CONTENT: its pino logger writes
 * the judge's `reasoning` — a verdict about the simulated conversation — to
 * stdout, and its stderr is an unbounded, unsanitised stream. Forwarding either
 * at `info`/`warn` copied that content verbatim into the platform's own log
 * retention.
 *
 * These tests pin BOTH halves of the fix: nothing the child wrote appears above
 * `debug`, and an operator can still tell from the levels that survive why the
 * child died.
 *
 * @see specs/scenarios/simulation-runner.feature
 */

import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const JUDGE_REASONING =
  "The agent refused to refund order 4471 for Ada Lovelace";
const CHILD_STDOUT_LINE = JSON.stringify({
  level: 40,
  reasoning: JUDGE_REASONING,
  msg: "scenario failed",
});
const CHILD_STDERR_LINE =
  "Error: ECONNREFUSED connecting to https://agent.customer.example/chat";

const loggerCalls = vi.hoisted(
  () =>
    [] as {
      level: "debug" | "info" | "warn" | "error";
      fields: unknown;
      message: unknown;
    }[],
);

vi.mock("@langwatch/observability", () => {
  const record =
    (level: "debug" | "info" | "warn" | "error") =>
    (fields: unknown, message?: unknown) => {
      loggerCalls.push({ level, fields, message });
    };
  const logger: Record<string, unknown> = {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

vi.mock("child_process", () => ({
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { on: () => void; write: () => void; end: () => void };
      pid: number;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      on: () => undefined,
      write: () => undefined,
      end: () => undefined,
    };
    child.pid = 4242;
    child.kill = () => undefined;
    setImmediate(() => {
      child.stdout.emit("data", Buffer.from(`${CHILD_STDOUT_LINE}\n`));
      child.stderr.emit("data", Buffer.from(`${CHILD_STDERR_LINE}\n`));
      child.emit("close", 1);
    });
    return child;
  },
}));

vi.mock("../execution/child-process-spawn", () => ({
  resolveChildProcessSpawn: () => ({ command: "node", args: ["runner.js"] }),
}));

vi.mock("../execution/child-tls-env", () => ({
  resolveChildTlsEnv: () => ({}),
}));

vi.mock("../execution/data-prefetcher", () => ({
  createDataPrefetcherDependencies: () => ({}),
  prefetchScenarioData: async () => ({
    success: true,
    data: { scenario: { labels: [] } },
    telemetry: { endpoint: "http://localhost:1", apiKey: "key" },
  }),
}));

import type { ExecutionJobData } from "../execution/execution-pool";
import { executeScenarioRun } from "../scenario.processor";

const jobData: ExecutionJobData = {
  projectId: "proj_1",
  scenarioId: "scen_1",
  setId: "set_1",
  batchRunId: "batch_1",
  scenarioRunId: "run_1",
  target: { type: "http", referenceId: "agent_1" },
} as unknown as ExecutionJobData;

function makePool() {
  return {
    wasCancelled: () => false,
    registerChild: () => undefined,
    deregisterChild: () => undefined,
    markCancelled: () => undefined,
    drain: () => undefined,
    runningChildren: new Map(),
  };
}

function makeDeps() {
  return {
    scenarioLookup: { getById: async () => null },
    failureEmitter: { ensureFailureEventsEmitted: async () => undefined },
  };
}

function callsAtOrAbove(level: "info" | "warn" | "error") {
  const ranking = { debug: 0, info: 1, warn: 2, error: 3 };
  return loggerCalls.filter((call) => ranking[call.level] >= ranking[level]);
}

describe("given a scenario child that writes judge reasoning and dies", () => {
  beforeEach(async () => {
    loggerCalls.length = 0;
    await executeScenarioRun(jobData, makePool() as never, makeDeps() as never);
  });

  describe("when the parent forwards the child's output", () => {
    it("keeps every line the child wrote out of info and above", () => {
      const aboveDebug = JSON.stringify(callsAtOrAbove("info"));
      expect(aboveDebug).not.toContain(JUDGE_REASONING);
      expect(aboveDebug).not.toContain("ECONNREFUSED");
      expect(aboveDebug).not.toContain("agent.customer.example");
    });

    it("forwards the child's stdout and stderr at debug", () => {
      const debugMessages = loggerCalls
        .filter((call) => call.level === "debug")
        .map((call) => JSON.stringify([call.fields, call.message]))
        .join("\n");
      expect(debugMessages).toContain(JUDGE_REASONING);
      expect(debugMessages).toContain("ECONNREFUSED");
    });
  });

  describe("when the child exits non-zero", () => {
    it("reports the exit code and a classified reason at error level", () => {
      const exitLog = loggerCalls.find(
        (call) =>
          call.level === "error" &&
          call.message === "Child process exited with code 1",
      );
      expect(exitLog?.fields).toEqual({
        exitCode: 1,
        errorCode: "scenario_platform_unreachable",
      });
    });

    it("reports the failure with a code rather than the raw error text", () => {
      const failureLog = loggerCalls.find(
        (call) => call.message === "Scenario job completed with failure",
      );
      expect(failureLog?.level).toBe("warn");
      expect(failureLog?.fields).toMatchObject({
        success: false,
        errorCode: "scenario_platform_unreachable",
      });
      expect(failureLog?.fields).not.toHaveProperty("error");
    });
  });
});
