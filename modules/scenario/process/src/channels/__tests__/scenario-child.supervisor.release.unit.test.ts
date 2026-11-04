/**
 * @vitest-environment node
 *
 * @see specs/scenarios/execution-blocked-by-configuration.feature
 */
import { ChildProcess } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

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
  vi.spyOn(child, "kill").mockReturnValue(killed);
  const log = vi.fn();
  const session = superviseScenarioChild({ child, jobData, pool, log });
  return { child, log, session };
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
});
