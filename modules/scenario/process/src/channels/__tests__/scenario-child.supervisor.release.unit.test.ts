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

function supervised() {
  const child = new ChildProcess();
  const kill = vi.spyOn(child, "kill").mockImplementation(() => {
    child.emit("close", null);
    return true;
  });
  const log = vi.fn();
  const session = superviseScenarioChild({ child, jobData, pool, log });
  return { child, kill, log, session };
}

const levelsLogged = (log: ReturnType<typeof vi.fn>) => log.mock.calls.map(([level]) => level);

describe("given a scenario child process", () => {
  describe("when the processor releases it and it closes without an exit code", () => {
    /** @scenario A child the processor released is logged at info, a child that dies by itself still at error */
    it("logs the close at info and never at error", async () => {
      const { log, session } = supervised();

      await session.abort();

      expect(levelsLogged(log)).toContain("info");
      expect(levelsLogged(log)).not.toContain("error");
      expect(log).toHaveBeenCalledWith(
        "info",
        "Child process stopped after its run was released",
        expect.anything(),
      );
    });
  });

  describe("when it closes without an exit code and nobody released it", () => {
    /** @scenario A child the processor released is logged at info, a child that dies by itself still at error */
    it("still logs the close at error and fails the run", async () => {
      const { child, kill, log } = supervised();
      kill.mockImplementation(() => true);

      child.emit("close", null);

      expect(log).toHaveBeenCalledWith(
        "error",
        "Child process exited with code null",
        expect.anything(),
      );
    });
  });
});
