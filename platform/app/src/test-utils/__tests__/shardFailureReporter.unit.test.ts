/**
 * The accounting behind the unit shard's hard floor.
 *
 * The reporter runs in vitest's main process and this test runs in a worker,
 * so driving the reporter here cannot disturb the reporter watching this run.
 *
 * @see src/test-unit-global-setup.ts
 * @see specs/ci/unit-shard-hard-floor.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hardFloorReport,
  resolveHardFloorMs,
} from "../../test-unit-global-setup";
import ShardFailureReporter, {
  resetShardState,
  shardModuleTally,
  shardSawFailure,
} from "../shardFailureReporter";

/** The event vitest emits for a module, reduced to what the reporter reads. */
function module(moduleId: string): { moduleId: string } {
  return { moduleId };
}

/** The event vitest emits for a finished test case. */
function testCase(state: string): { result: () => { state: string } } {
  return { result: () => ({ state }) };
}

const FLOOR_MS = 4 * 60 * 1000;

/** What the floor would print and exit with, from the current shard state. */
function report(): { exitCode: 0 | 1; lines: string[] } {
  return hardFloorReport({
    hardFloorMs: FLOOR_MS,
    sawFailure: shardSawFailure(),
    modules: shardModuleTally(),
  });
}

describe("given a shard the finalize wedge is holding open", () => {
  afterEach(resetShardState);

  describe("when every file vitest started reported a result", () => {
    /** @scenario "A wedge over a clean run still releases the step green" */
    it("names no file and releases the step green", () => {
      const reporter = new ShardFailureReporter();
      reporter.onTestRunStart([module("/repo/a.unit.test.ts")]);
      reporter.onTestModuleQueued(module("/repo/a.unit.test.ts"));
      reporter.onTestModuleEnd(module("/repo/a.unit.test.ts"));

      expect(shardModuleTally().unreportedFiles).toEqual([]);

      const { exitCode, lines } = report();

      expect(exitCode).toBe(0);
      expect(lines).toEqual([
        "[unit globalSetup] hard floor reached at 4 min - forcing process.exit(0) to release the CI step from a vitest finalize wedge",
        "[unit globalSetup] test files: 1 selected, 1 started, 1 reported a result",
      ]);
    });
  });

  describe("when a test failed before the wedge", () => {
    /** @scenario "A wedge over a failing run stays red" */
    it("stays red and says the failures came first", () => {
      const reporter = new ShardFailureReporter();
      reporter.onTestRunStart([module("/repo/a.unit.test.ts")]);
      reporter.onTestModuleQueued(module("/repo/a.unit.test.ts"));
      reporter.onTestCaseResult(testCase("failed"));
      reporter.onTestModuleEnd(module("/repo/a.unit.test.ts"));

      const { exitCode, lines } = report();

      expect(exitCode).toBe(1);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("process.exit(1)");
      expect(lines[0]).toContain("failures were reported before the wedge");
    });
  });

  describe("when a file started and never reported a result", () => {
    /** @scenario "A file that started and never reported turns the shard red" */
    it("turns the shard red naming the file and how to reproduce it", () => {
      const reporter = new ShardFailureReporter();
      reporter.onTestRunStart([
        module("src/hangs.unit.test.tsx"),
        module("src/finishes.unit.test.ts"),
      ]);
      reporter.onTestModuleQueued(module("src/hangs.unit.test.tsx"));
      reporter.onTestModuleQueued(module("src/finishes.unit.test.ts"));
      reporter.onTestModuleEnd(module("src/finishes.unit.test.ts"));

      expect(shardModuleTally().unreportedFiles).toEqual([
        "src/hangs.unit.test.tsx",
      ]);
      expect(shardSawFailure()).toBe(false);

      const { exitCode, lines } = report();

      expect(exitCode).toBe(1);
      expect(lines[0]).toContain(
        "1 test file started and never reported a result",
      );
      expect(lines[1]).toBe(
        "[unit globalSetup] test files: 2 selected, 2 started, 1 reported a result",
      );
      expect(lines[2]).toContain("never completed");
      expect(lines[3]).toBe("[unit globalSetup]   src/hangs.unit.test.tsx");
      expect(lines[4]).toContain("pnpm test:unit run <file>");
    });

    it("counts every such file when more than one hangs", () => {
      const reporter = new ShardFailureReporter();
      reporter.onTestRunStart([
        module("src/b.unit.test.ts"),
        module("src/a.unit.test.ts"),
      ]);
      reporter.onTestModuleQueued(module("src/b.unit.test.ts"));
      reporter.onTestModuleQueued(module("src/a.unit.test.ts"));

      const { exitCode, lines } = report();

      expect(exitCode).toBe(1);
      expect(lines[0]).toContain(
        "2 test files started and never reported a result",
      );
      expect(lines.slice(3, 5)).toEqual([
        "[unit globalSetup]   src/a.unit.test.ts",
        "[unit globalSetup]   src/b.unit.test.ts",
      ]);
    });
  });

  describe("when the shard still had files left to start", () => {
    /** @scenario "The floor says how much of the shard it cut off" */
    it("counts the shard and calls it too slow rather than wedged", () => {
      const reporter = new ShardFailureReporter();
      reporter.onTestRunStart([
        module("src/a.unit.test.ts"),
        module("src/b.unit.test.ts"),
        module("src/c.unit.test.ts"),
      ]);
      reporter.onTestModuleQueued(module("src/a.unit.test.ts"));
      reporter.onTestModuleEnd(module("src/a.unit.test.ts"));
      reporter.onTestModuleQueued(module("src/b.unit.test.ts"));

      const { lines } = report();

      expect(lines[1]).toBe(
        "[unit globalSetup] test files: 3 selected, 2 started, 1 reported a result",
      );
      expect(lines[2]).toContain("too slow for the floor, not as a hang");
    });

    it("says nothing about slowness once every file has started", () => {
      const reporter = new ShardFailureReporter();
      reporter.onTestRunStart([module("src/a.unit.test.ts")]);
      reporter.onTestModuleQueued(module("src/a.unit.test.ts"));
      reporter.onTestModuleEnd(module("src/a.unit.test.ts"));

      expect(report().lines.join("\n")).not.toContain("too slow for the floor");
    });
  });

  describe("when a file is skipped in full", () => {
    /** @scenario "A skipped file is never mistaken for one that never completed" */
    it("leaves the shard the way a passing file does", () => {
      // A describe.skip, an env-gated describe.skipIf, and a file of it.todo
      // all reach onTestModuleEnd, so the reporter sees the same pair of
      // events it sees for a file that ran.
      const reporter = new ShardFailureReporter();
      reporter.onTestRunStart([module("/repo/skipped.unit.test.ts")]);
      reporter.onTestModuleQueued(module("/repo/skipped.unit.test.ts"));
      reporter.onTestModuleEnd(module("/repo/skipped.unit.test.ts"));

      expect(shardModuleTally()).toMatchObject({
        selected: 1,
        started: 1,
        reported: 1,
        unreportedFiles: [],
      });
      expect(shardSawFailure()).toBe(false);
    });
  });

  describe("when vitest reported the run finished", () => {
    /** @scenario "A run that reached its own end is left to its own accounting" */
    it("names no file even if a module event was lost", () => {
      const reporter = new ShardFailureReporter();
      reporter.onTestRunStart([module("/repo/a.unit.test.ts")]);
      reporter.onTestModuleQueued(module("/repo/a.unit.test.ts"));
      reporter.onTestRunEnd([], [], "passed");

      expect(shardModuleTally().unreportedFiles).toEqual([]);
      expect(report().exitCode).toBe(0);
    });

    it("keeps the totals so the floor can still say how far it got", () => {
      const reporter = new ShardFailureReporter();
      reporter.onTestRunStart([module("/repo/a.unit.test.ts")]);
      reporter.onTestModuleQueued(module("/repo/a.unit.test.ts"));
      reporter.onTestRunEnd([], [], "passed");

      expect(report().lines[1]).toBe(
        "[unit globalSetup] test files: 1 selected, 1 started, 0 reported a result",
      );
    });

    it("still records a failed run", () => {
      const reporter = new ShardFailureReporter();
      reporter.onTestRunEnd([], [], "failed");

      expect(shardSawFailure()).toBe(true);
    });

    it("still records an unhandled error", () => {
      const reporter = new ShardFailureReporter();
      reporter.onTestRunEnd([], [new Error("boom")], "passed");

      expect(shardSawFailure()).toBe(true);
    });
  });
});

describe("given the counters behind the floor's log line", () => {
  afterEach(resetShardState);

  describe("when a second run starts in the same process", () => {
    /** @scenario "A second run in the same process is counted on its own" */
    it("counts the new file list alone", () => {
      const reporter = new ShardFailureReporter();
      reporter.onTestRunStart([
        module("src/a.unit.test.ts"),
        module("src/b.unit.test.ts"),
      ]);
      reporter.onTestModuleQueued(module("src/a.unit.test.ts"));
      reporter.onTestModuleEnd(module("src/a.unit.test.ts"));
      reporter.onTestModuleQueued(module("src/b.unit.test.ts"));
      reporter.onTestModuleEnd(module("src/b.unit.test.ts"));

      reporter.onTestRunStart([module("src/a.unit.test.ts")]);

      expect(shardModuleTally()).toEqual({
        selected: 1,
        started: 0,
        reported: 0,
        unreportedFiles: [],
      });
      expect(report().lines[1]).toBe(
        "[unit globalSetup] test files: 1 selected, 0 started, 0 reported a result",
      );
    });
  });

  describe("when the same file is queued twice while still in flight", () => {
    it("counts it once, so the count and the in-flight set agree", () => {
      const reporter = new ShardFailureReporter();
      reporter.onTestRunStart([module("src/a.unit.test.ts")]);
      reporter.onTestModuleQueued(module("src/a.unit.test.ts"));
      reporter.onTestModuleQueued(module("src/a.unit.test.ts"));

      expect(shardModuleTally()).toEqual({
        selected: 1,
        started: 1,
        reported: 0,
        unreportedFiles: ["src/a.unit.test.ts"],
      });
    });
  });
});

describe("given how long the shard may stay alive before the floor fires", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("when the override names a positive number of milliseconds", () => {
    it("arms the floor at that number, CI or not", () => {
      vi.stubEnv("LANGWATCH_UNIT_HARD_FLOOR_MS", "1500");
      vi.stubEnv("CI", "");

      expect(resolveHardFloorMs()).toBe(1500);
    });
  });

  describe("when the override is absent", () => {
    it("leaves the floor disarmed off CI and says nothing", () => {
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      vi.stubEnv("LANGWATCH_UNIT_HARD_FLOOR_MS", "");
      vi.stubEnv("CI", "");

      expect(resolveHardFloorMs()).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("when the override is set to something that is not a duration", () => {
    it("falls back to the default and names the value it ignored", () => {
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      vi.stubEnv("LANGWATCH_UNIT_HARD_FLOOR_MS", "4m");
      vi.stubEnv("CI", "1");

      expect(resolveHardFloorMs()).toBe(4 * 60 * 1000);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('"4m"');
    });
  });
});
