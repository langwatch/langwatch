import { describe, expect, it, vi } from "vitest";

import type { IntentContext } from "~/server/event-sourcing.old/pipeline/processManagerDefinition";

import { ScenarioExecutorUnavailableError } from "~/server/scenarios/execution/execution-dispatcher";

import {
  createScenarioExecutionExecuteRunHandler,
  createScenarioExecutionFailRunHandler,
  type ScenarioExecutionDispatchDeps,
} from "../scenarioExecutionIntentHandlers";
import type {
  ScenarioExecutionExecuteRunIntent,
  ScenarioExecutionFailRunIntent,
} from "../scenarioExecutionProcess.types";

const CTX: IntentContext = {
  processName: "scenarioExecution",
  projectId: "project-1",
  processKey: "run-1",
  tenantId: "project-1",
  messageKey: "process:run-1:fail:run-1",
  attempt: 1,
};

const INTENT: ScenarioExecutionFailRunIntent = {
  projectId: "project-1",
  scenarioRunId: "run-1",
  scenarioId: "scenario-1",
  batchRunId: "batch-1",
  setId: "set-1",
  outcome: "stalled",
  reason: "Scenario run stopped reporting progress",
};

const EXECUTE_INTENT: ScenarioExecutionExecuteRunIntent = {
  projectId: "project-1",
  scenarioRunId: "run-1",
  scenarioId: "scenario-1",
  batchRunId: "batch-1",
  setId: "set-1",
  target: { type: "http", referenceId: "agent-1" },
};

type EmitFailure = ScenarioExecutionDispatchDeps["emitFailure"];
type LookupScenario = ScenarioExecutionDispatchDeps["lookupScenario"];
type ExecuteRun = ScenarioExecutionDispatchDeps["executeRun"];
type ReadRunStatus = ScenarioExecutionDispatchDeps["readRunStatus"];

function makeDeps(overrides: Partial<ScenarioExecutionDispatchDeps> = {}) {
  return {
    executeRun: vi.fn<ExecuteRun>(async () => undefined),
    readRunStatus: vi.fn<ReadRunStatus>(async () => "QUEUED"),
    emitFailure: vi.fn<EmitFailure>(async () => undefined),
    lookupScenario: vi.fn<LookupScenario>(async () => ({
      name: "Refund flow",
      situation: "A cross customer",
    })),
    ...overrides,
  };
}

describe("scenarioExecution executeRun intent", () => {
  describe("given the run is still waiting to be picked up", () => {
    it("runs it", async () => {
      const deps = makeDeps();

      await createScenarioExecutionExecuteRunHandler(deps)(
        EXECUTE_INTENT,
        CTX,
      );

      expect(deps.executeRun).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          scenarioRunId: "run-1",
          target: { type: "http", referenceId: "agent-1" },
        }),
      );
    });

    it("runs it when nothing has been folded for it yet", async () => {
      // The ordinary case: the dispatch is racing its own projection.
      const deps = makeDeps({
        readRunStatus: vi.fn<ReadRunStatus>(async () => null),
      });

      await createScenarioExecutionExecuteRunHandler(deps)(
        EXECUTE_INTENT,
        CTX,
      );

      expect(deps.executeRun).toHaveBeenCalledTimes(1);
    });
  });

  describe("when nothing is wired to execute the run", () => {
    /**
     * The defect this replaced: the retired reactor logged
     * "Execution pool not yet wired, skipping" and returned, so the run
     * orphaned at QUEUED with nothing recorded anywhere.
     */
    it("leaves the dispatch pending so it is retried, not dropped", async () => {
      const deps = makeDeps({
        executeRun: vi.fn<ExecuteRun>(async () => {
          throw new ScenarioExecutorUnavailableError();
        }),
      });

      await expect(
        createScenarioExecutionExecuteRunHandler(deps)(EXECUTE_INTENT, CTX),
      ).rejects.toBeInstanceOf(ScenarioExecutorUnavailableError);

      // Nothing was spawned, so nothing is recorded against the run either —
      // it is still waiting for a worker, not finished.
      expect(deps.emitFailure).not.toHaveBeenCalled();
    });
  });

  describe("given the run has already left the queue", () => {
    /**
     * A lease that lapses because its worker was hard-killed is re-leased with
     * the attempt counter unchanged, so `maxAttempts` cannot see it. The run's
     * own status can.
     */
    it.each(["IN_PROGRESS", "SUCCESS", "ERROR", "STALLED", "CANCELLED"])(
      "does not run it again when it is %s",
      async (status) => {
        const deps = makeDeps({
          readRunStatus: vi.fn<ReadRunStatus>(async () => status),
        });

        await createScenarioExecutionExecuteRunHandler(deps)(
          EXECUTE_INTENT,
          CTX,
        );

        expect(deps.executeRun).not.toHaveBeenCalled();
      },
    );

    it("acknowledges the redelivery instead of failing it back onto the outbox", async () => {
      const deps = makeDeps({
        readRunStatus: vi.fn<ReadRunStatus>(async () => "IN_PROGRESS"),
      });

      await expect(
        createScenarioExecutionExecuteRunHandler(deps)(EXECUTE_INTENT, CTX),
      ).resolves.toBeUndefined();
    });
  });

  describe("when execution faults after the run was dispatched", () => {
    it("records it as failed rather than throwing it back for a re-run", async () => {
      const deps = makeDeps({
        executeRun: vi.fn<ExecuteRun>(async () => {
          throw new Error("child spawn blew up");
        }),
      });

      // Throwing here would re-lease a message whose scenario may already have
      // spent money and recorded messages.
      await expect(
        createScenarioExecutionExecuteRunHandler(deps)(EXECUTE_INTENT, CTX),
      ).resolves.toBeUndefined();

      expect(deps.emitFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioRunId: "run-1",
          outcome: "error",
          error: "child spawn blew up",
        }),
      );
    });

    it("leaves the run to its deadline when even the failure write fails", async () => {
      const deps = makeDeps({
        executeRun: vi.fn<ExecuteRun>(async () => {
          throw new Error("child spawn blew up");
        }),
        emitFailure: vi.fn<EmitFailure>(async () => {
          throw new Error("clickhouse down");
        }),
      });

      // Losing the record is recoverable — the armed deadline still ends the
      // run. Running the scenario twice is not.
      await expect(
        createScenarioExecutionExecuteRunHandler(deps)(EXECUTE_INTENT, CTX),
      ).resolves.toBeUndefined();
    });
  });
});

describe("scenarioExecution failRun intent", () => {
  describe("given the scenario is readable", () => {
    /** @scenario "A reaped run reads like any other in the list" */
    it("carries the scenario's display fields onto the terminal write", async () => {
      const deps = makeDeps();

      await createScenarioExecutionFailRunHandler(deps)(INTENT, CTX);

      expect(deps.emitFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioRunId: "run-1",
          name: "Refund flow",
          description: "A cross customer",
          error: "Scenario run stopped reporting progress",
          outcome: "stalled",
        }),
      );
    });
  });

  describe("when the scenario cannot be read", () => {
    it("still writes the terminal state", async () => {
      const deps = makeDeps({
        lookupScenario: vi.fn<LookupScenario>(async () => {
          throw new Error("pg down");
        }),
      });

      await createScenarioExecutionFailRunHandler(deps)(INTENT, CTX);

      // Display fields are cosmetic. Losing them must never cost the run the
      // terminal state this process exists to write.
      expect(deps.emitFailure).toHaveBeenCalledTimes(1);
      expect(deps.emitFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioRunId: "run-1",
          error: "Scenario run stopped reporting progress",
          name: undefined,
          description: undefined,
        }),
      );
    });

    it("still writes the terminal state when the scenario is simply gone", async () => {
      const deps = makeDeps({
        lookupScenario: vi.fn<LookupScenario>(async () => null),
      });

      await createScenarioExecutionFailRunHandler(deps)(INTENT, CTX);

      expect(deps.emitFailure).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Only `queued` and `started` name the scenario, so a run described purely by
   * its progress reports reaches here without one. The wake stopped refusing to
   * terminalise such a run; the lookup must not reintroduce the refusal by
   * querying for a scenario that cannot exist.
   */
  describe("given the run reached here with no scenario id", () => {
    /** @scenario "A run known only from its progress reports is still ended" */
    it("writes the terminal state without looking a scenario up", async () => {
      const deps = makeDeps();

      await createScenarioExecutionFailRunHandler(deps)(
        { ...INTENT, scenarioId: "" },
        CTX,
      );

      expect(deps.lookupScenario).not.toHaveBeenCalled();
      expect(deps.emitFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioRunId: "run-1",
          name: undefined,
          description: undefined,
          outcome: "stalled",
        }),
      );
    });
  });

  describe("when the terminal write itself fails", () => {
    it("throws so the outbox retries it", async () => {
      const deps = makeDeps({
        emitFailure: vi.fn<EmitFailure>(async () => {
          throw new Error("clickhouse down");
        }),
      });

      // Swallowing here would leave the run non-terminal forever, which is the
      // exact failure this process exists to remove. `finishRun` is idempotent,
      // so the retry is safe.
      await expect(
        createScenarioExecutionFailRunHandler(deps)(INTENT, CTX),
      ).rejects.toThrow("clickhouse down");
    });
  });

  describe("given the run was cancelled", () => {
    it("passes the cancellation through so it is not recorded as an error", async () => {
      const deps = makeDeps();

      await createScenarioExecutionFailRunHandler(deps)(
        {
          ...INTENT,
          outcome: "cancelled",
          reason: "Cancelled — no worker reported the run finished",
        },
        CTX,
      );

      expect(deps.emitFailure).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "cancelled" }),
      );
    });
  });
});
