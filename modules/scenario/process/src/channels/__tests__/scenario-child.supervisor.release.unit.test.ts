/**
 * @vitest-environment node
 *
 * @see specs/scenarios/execution-blocked-by-configuration.feature
 */
import { ChildProcess } from "node:child_process";
import { Writable } from "node:stream";

import { CHILD_PROCESS } from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

// The supervisor imports its timers from node:timers, which fake timers do not
// patch; delegating to the globals at call time lets the timeout test drive them.
vi.mock("node:timers", () => ({
  setTimeout: (handler: () => void, delayMs?: number) => globalThis.setTimeout(handler, delayMs),
  clearTimeout: (timer?: NodeJS.Timeout) => globalThis.clearTimeout(timer),
}));

import type { ExecutionJobData } from "../../services/scenario-execution-pool.service.ts";
import type { ScenarioChildRunPool } from "../scenario-child.channel.ts";
import { superviseScenarioChild } from "../scenario-child.supervisor.channel.ts";

const jobData: ExecutionJobData = {
  projectId: "project_test",
  scenarioId: "scenario_test",
  scenarioRunId: "run_test",
  batchRunId: "batch_test",
  setId: "set_test",
  target: { type: "http", referenceId: "agent_test" },
};

const pool: ScenarioChildRunPool = {
  registerChild: () => {},
  deregisterChild: () => {},
  wasCancelled: () => false,
};

function supervised({ killed }: { killed: boolean }) {
  const child = new ChildProcess();
  const calls: string[] = [];
  child.stdin = new Writable({ write: (_chunk, _encoding, done) => done() });
  const end = vi.spyOn(child.stdin, "end").mockImplementation(() => {
    calls.push("end");
    return child.stdin as Writable;
  });
  vi.spyOn(child, "kill").mockImplementation(() => {
    calls.push("kill");
    return killed;
  });
  const log = vi.fn();
  const session = superviseScenarioChild({ child, jobData, pool, log });
  return { child, log, session, calls, end };
}

const levelsLogged = (log: ReturnType<typeof vi.fn>) => log.mock.calls.map(([level]) => level);

async function releaseThenClose({
  killed,
  code,
  signal,
}: {
  killed: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
}) {
  const { child, log, session } = supervised({ killed });
  const aborted = session.abort();
  child.emit("close", code, signal);
  await aborted;
  return log;
}

describe("given a scenario child process", () => {
  describe("when the processor releases it and SIGTERM ends it", () => {
    /** @scenario A child the processor released is logged at info, a child that dies by itself still at error */
    it("logs the close at info and never at error", async () => {
      const log = await releaseThenClose({ killed: true, code: null, signal: "SIGTERM" });

      expect(levelsLogged(log)).toContain("info");
      expect(levelsLogged(log)).not.toContain("error");
      expect(log).toHaveBeenCalledWith(
        "info",
        "Child process stopped after its run was released",
        expect.anything(),
      );
    });
  });

  describe("when the processor releases a child that traps SIGTERM and exits with a code", () => {
    /** @scenario A child the processor released is logged at info, a child that dies by itself still at error */
    it("logs the close at info, carrying the exit code and no signal", async () => {
      const log = await releaseThenClose({ killed: true, code: 1, signal: null });

      expect(levelsLogged(log)).not.toContain("error");
      expect(log).toHaveBeenCalledWith(
        "info",
        "Child process stopped after its run was released",
        expect.objectContaining({ exitCode: 1, signal: null }),
      );
    });
  });

  describe("when the processor releases it but something else ended it", () => {
    /** @scenario A child the processor released is logged at info, a child that dies by itself still at error */
    it.each([
      { name: "SIGKILL", killed: true, code: null, signal: "SIGKILL" as const },
      { name: "a numeric exit before the abort", killed: false, code: 1, signal: null },
      { name: "a kill that did not land", killed: false, code: null, signal: "SIGKILL" as const },
    ])("still logs the close at error after $name", async ({ killed, code, signal }) => {
      const log = await releaseThenClose({ killed, code, signal });

      expect(levelsLogged(log)).toContain("error");
      expect(levelsLogged(log)).not.toContain("info");
      expect(log).toHaveBeenCalledWith(
        "error",
        expect.any(String),
        expect.objectContaining({ signal }),
      );
    });
  });

  describe("when nobody released it and it is killed", () => {
    /** @scenario A child the processor released is logged at info, a child that dies by itself still at error */
    it("still logs the close at error", () => {
      const { child, log } = supervised({ killed: true });

      child.emit("close", null, "SIGKILL");

      expect(log).toHaveBeenCalledWith(
        "error",
        "Child process exited with code null",
        expect.anything(),
      );
    });
  });

  describe("when the processor releases it", () => {
    /** @scenario A child the processor released is logged at info, a child that dies by itself still at error */
    it("ends its stdin after the kill, so a child blocked reading its job can stop", async () => {
      const { child, session, calls } = supervised({ killed: true });
      const aborted = session.abort();
      child.emit("close", null, "SIGTERM");
      await aborted;

      expect(calls).toEqual(["kill", "end"]);
    });

    /** @scenario A child the processor released is logged at info, a child that dies by itself still at error */
    it("does not throw when a stdin end throws, and still counts as released", async () => {
      const { child, end, log, session } = supervised({ killed: true });
      end.mockImplementation(() => {
        throw new Error("write after end");
      });
      const aborted = session.abort();
      child.emit("close", null, "SIGTERM");

      await expect(aborted).resolves.toBeUndefined();
      expect(levelsLogged(log)).toContain("warn");
      expect(log).toHaveBeenCalledWith(
        "info",
        "Child process stopped after its run was released",
        expect.anything(),
      );
    });

    /** @scenario A child the processor released is logged at info, a child that dies by itself still at error */
    it("does not throw after the job was already sent and stdin ended", async () => {
      const { child, session } = supervised({ killed: true });
      const completion = session.execute({} as never);
      const aborted = session.abort();
      child.emit("close", null, "SIGTERM");

      await expect(aborted).resolves.toBeUndefined();
      await completion;
    });
  });

  describe("when it runs past the timeout", () => {
    /** @scenario A child the processor released is logged at info, a child that dies by itself still at error */
    it("kills it, then ends its stdin, and logs the timeout at error", () => {
      vi.useFakeTimers();
      try {
        const { calls, log } = supervised({ killed: true });

        vi.advanceTimersByTime(CHILD_PROCESS.TIMEOUT_MS);

        expect(calls).toEqual(["kill", "end"]);
        expect(log).toHaveBeenCalledWith("error", "Child process timed out", expect.anything());
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
