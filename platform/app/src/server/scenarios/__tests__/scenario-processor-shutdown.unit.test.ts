/**
 * @vitest-environment node
 *
 * What the worker does with the runs it is holding when it is asked to stop.
 *
 * A deploy is the most common way a scenario run loses its worker, and the
 * only one where the worker gets a chance to say anything. Killing the child
 * and exiting leaves the terminal write to a race: the child's own close
 * handler tries to record the failure, but nothing waits for it, so on a
 * rolling restart the run's terminal state is whatever landed before the
 * process went away — and when it loses, the run sits non-terminal until its
 * durable deadline fires roughly half an hour later.
 *
 * These tests drive the REAL `startScenarioProcessor(...).close()` with a real
 * pool and a child that only exits when it is signalled, so the loss is
 * observable: the assertion is on what has been recorded by the moment
 * `close()` resolves, which is the last moment the process is alive.
 *
 * @see specs/scenarios/scenario-execution-process-manager.feature
 */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Children handed out by the mocked `spawn`, so a test can inspect them. */
const spawnedChildren = vi.hoisted(() => [] as SpawnedChild[]);

interface SpawnedChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { on: () => void; write: () => void; end: () => void };
  pid: number;
  kill: (signal?: string) => boolean;
  signalled: string[];
}

vi.mock("child_process", () => ({
  spawn: () => {
    const child = new EventEmitter() as SpawnedChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      on: () => undefined,
      write: () => undefined,
      end: () => undefined,
    };
    child.pid = 9001;
    child.signalled = [];
    // A real child does not die inside `kill()`. The exit arrives on a later
    // turn of the loop, which is exactly the window the shutdown used to lose.
    child.kill = (signal?: string) => {
      child.signalled.push(signal ?? "SIGTERM");
      setImmediate(() => child.emit("close", 143));
      return true;
    };
    spawnedChildren.push(child);
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

// A truthy connection is what makes `startScenarioProcessor` return a handle
// at all; nothing in these tests talks to Redis.
vi.mock("../../redis", () => ({
  connection: { duplicate: () => ({}) },
}));

vi.mock("../cancellation-channel", () => ({
  subscribeToCancellations: async () => async () => undefined,
}));

// The boot sweeps are a separate concern (a one-time cutover drain) and would
// otherwise reach for ClickHouse.
vi.mock("../../clickhouse/clickhouseClient", () => ({
  getSharedClickHouseClient: () => null,
}));

vi.mock("../orphaned-run-reconciliation.clickhouse", () => ({
  reconcileOrphanedRunsOnBoot: async () => undefined,
}));

import type { ExecutionJobData } from "../execution/execution-pool";
import { ScenarioExecutionPool } from "../execution/execution-pool";
import { SCENARIO_WORKER } from "../scenario.constants";
import {
  executeScenarioRun,
  type ProcessorDependencies,
  startScenarioProcessor,
} from "../scenario.processor";
import type { FailureEventParams } from "../scenario-failure-handler";

function makeJob(scenarioRunId: string): ExecutionJobData {
  return {
    projectId: "proj-1",
    scenarioId: `scen-${scenarioRunId}`,
    scenarioRunId,
    batchRunId: "batch-1",
    setId: "set-1",
    target: { type: "http", referenceId: "agent-1" },
  };
}

/**
 * Dependencies wired to a recorder owned by ONE test.
 *
 * Deliberately not a shared `let` reassigned in `beforeEach`: a run left in
 * flight by a failing assertion keeps writing through the closure it was given,
 * and would land in the next test's recorder.
 */
function makeDeps(
  ensureFailureEventsEmitted: (params: FailureEventParams) => Promise<void>,
): ProcessorDependencies {
  return {
    scenarioLookup: {
      getById: async () => ({ name: "Refund flow", situation: "A situation" }),
    },
    failureEmitter: { ensureFailureEventsEmitted },
  };
}

/** Deps that append every terminal write to their own list. */
function makeRecordingDeps(): {
  deps: ProcessorDependencies;
  recorded: FailureEventParams[];
} {
  const recorded: FailureEventParams[] = [];
  return {
    recorded,
    deps: makeDeps(async (params) => {
      recorded.push(params);
    }),
  };
}

/** Spin the loop until `predicate` holds, without polling on a real clock. */
async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("given scenario runs executing on this worker", () => {
  let pool: ScenarioExecutionPool;

  beforeEach(() => {
    spawnedChildren.length = 0;
    pool = new ScenarioExecutionPool();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when the worker is asked to shut down", () => {
    /**
     * The regression this file exists for: `close()` used to kill the child
     * and return, so the terminal write was still queued behind the child's
     * exit when the process left.
     *
     * @scenario "A run whose worker is redeployed is recorded before the worker exits"
     */
    it("records the run as finished before the shutdown resolves", async () => {
      const { deps, recorded } = makeRecordingDeps();
      const handle = await startScenarioProcessor(pool, deps);
      const running = executeScenarioRun(makeJob("run-1"), pool, deps);
      await until(() => pool.activeCount === 1);

      await handle!.close();

      expect(recorded.map((entry) => entry.scenarioRunId)).toContain("run-1");
      // Still an OS-resource obligation: the child is signalled, not merely
      // written off.
      expect(spawnedChildren[0]?.signalled).toEqual(["SIGTERM"]);
      await running;
    });

    /** @scenario "A run cancelled before the shutdown is recorded as cancelled" */
    it("records a cancelled run as cancelled rather than failed", async () => {
      const { deps, recorded } = makeRecordingDeps();
      const handle = await startScenarioProcessor(pool, deps);
      const running = executeScenarioRun(makeJob("run-1"), pool, deps);
      await until(() => pool.activeCount === 1);
      pool.markCancelled("run-1");

      await handle!.close();

      expect(recorded[0]).toMatchObject({
        scenarioRunId: "run-1",
        outcome: "cancelled",
      });
      await running;
    });

    /** @scenario "One run that cannot be recorded does not strand the others" */
    it("records the remaining runs when one of them cannot be recorded", async () => {
      const recorded: FailureEventParams[] = [];
      const deps = makeDeps(async (params) => {
        if (params.scenarioRunId === "run-1") {
          throw new Error("clickhouse said no");
        }
        recorded.push(params);
      });
      const handle = await startScenarioProcessor(pool, deps);
      // The executor propagating this is the intent handler's problem, not the
      // shutdown's — swallowed here so the assertion is about the shutdown.
      const running = Promise.allSettled([
        executeScenarioRun(makeJob("run-1"), pool, deps),
        executeScenarioRun(makeJob("run-2"), pool, deps),
      ]);
      await until(() => pool.activeCount === 2);

      await handle!.close();

      expect(recorded.map((entry) => entry.scenarioRunId)).toContain("run-2");
      await running;
    });

    /** @scenario "A shutdown is not held open by a run that will not settle" */
    it("finishes within its own time budget when a terminal record never completes", async () => {
      const deps = makeDeps(() => new Promise<void>(() => undefined));
      const handle = await startScenarioProcessor(pool, deps);
      void executeScenarioRun(makeJob("run-1"), pool, deps);
      await until(() => pool.activeCount === 1);

      vi.useFakeTimers();
      let settled = false;
      const closing = handle!.close().then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(
        SCENARIO_WORKER.SHUTDOWN_SETTLE_TIMEOUT_MS + 1,
      );

      expect(settled).toBe(true);
      await closing;
    });
  });
});
