import type { IntentContext } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import type { ExperimentRunCommandDispatcherService } from "../../services/experiment-run-command-dispatcher.service.ts";
import { completeRun, executeCell, failLostCell } from "../experiment-run-execution.intent.ts";
import { EXPERIMENT_RUN_INTENT_ATTEMPTS } from "../experiment-run-execution.schemas.ts";

type Sent = Parameters<ExperimentRunCommandDispatcherService["failExperimentCell"]>[0];
type Completed = Parameters<ExperimentRunCommandDispatcherService["completeExperimentRun"]>[0];
type Executed = Parameters<ExperimentRunCommandDispatcherService["executeExperimentCell"]>[0];

const intentContext: IntentContext = {
  processName: "experimentRunExecution",
  projectId: "project_alpha",
  processKey: "experiment_1:run_1",
  tenantId: "project_alpha",
  messageKey: "fail:3:1",
  attempt: 1,
};

function commands() {
  const failed: Sent[] = [];
  const completed: Completed[] = [];
  const executed: Executed[] = [];
  return {
    failed,
    completed,
    executed,
    commands: {
      executeExperimentCell: (input: Executed) => {
        executed.push(input);
        return Promise.resolve();
      },
      failExperimentCell: (input: Sent) => {
        failed.push(input);
        return Promise.resolve();
      },
      completeExperimentRun: (input: Completed) => {
        completed.push(input);
        return Promise.resolve();
      },
    },
  };
}

describe("the run manager's intents", () => {
  describe("when the window opens a cell", () => {
    /** @scenario "The worker runs an opened cell by its ordinal and phase" */
    it("sends the run's cell command naming only the cell, in the run's tenant", async () => {
      const { executed, commands: run } = commands();

      await executeCell(run)(
        { runId: "run_1", experimentId: "experiment_1", ordinal: 2, phase: 2 },
        intentContext,
      );

      expect(executed).toHaveLength(1);
      expect(executed[0]).toMatchObject({
        tenantId: "project_alpha",
        runId: "run_1",
        experimentId: "experiment_1",
        ordinal: 2,
        phase: 2,
      });
      expect(Object.keys(executed[0] ?? {}).toSorted()).toEqual([
        "experimentId",
        "occurredAt",
        "ordinal",
        "phase",
        "runId",
        "tenantId",
      ]);
    });
  });

  describe("when the stall wake gives up on a cell", () => {
    /** @scenario "A lost cell is failed as experiment_cell_lost" */
    it("finishes it failed with the lost-cell code, in the run's tenant", async () => {
      const { failed, commands: run } = commands();

      await failLostCell(run)(
        { runId: "run_1", experimentId: "experiment_1", ordinal: 3, phase: 1 },
        intentContext,
      );

      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({
        tenantId: "project_alpha",
        runId: "run_1",
        ordinal: 3,
        phase: 1,
        outcome: "failed",
      });
      expect(failed[0]?.error?.code).toBe("experiment_cell_lost");
    });
  });

  describe("when a stopping run's last cell in flight finishes", () => {
    it("completes the run stopped", async () => {
      const { completed, commands: run } = commands();

      await completeRun({ commands: run, boardWriteBack: { writeBack: async () => {} } })(
        { runId: "run_1", experimentId: "experiment_1", outcome: "stopped", finishedCells: 1 },
        intentContext,
      );

      expect(completed[0]).toMatchObject({ runId: "run_1", outcome: "stopped" });
      expect(completed[0]).toHaveProperty("stoppedAt");
      expect(completed[0]).not.toHaveProperty("finishedAt");
    });
  });

  describe("when a run's last cell finishes", () => {
    /** @scenario "A run's cells land on the board before it is completed" */
    it("writes the run's cells to the board first, then completes it", async () => {
      const order: string[] = [];
      const { commands: run } = commands();
      const complete = completeRun({
        commands: {
          ...run,
          completeExperimentRun: async (input: Completed) => {
            order.push(`complete:${input.runId}`);
          },
        },
        boardWriteBack: {
          writeBack: async ({ runId, finishedCells }) => {
            order.push(`board:${runId}:${finishedCells}`);
          },
        },
      });

      await complete(
        { runId: "run_1", experimentId: "experiment_1", outcome: "finished", finishedCells: 6 },
        intentContext,
      );

      expect(order).toEqual(["board:run_1:6", "complete:run_1"]);
    });

    /** @scenario "The board write waits until the progress fold has every finished cell" */
    it("does not complete while the board write waits for the fold, and tells its last attempt", async () => {
      const lastAttempts: boolean[] = [];
      const { completed, commands: run } = commands();
      const complete = completeRun({
        commands: run,
        boardWriteBack: {
          writeBack: async ({ lastAttempt }) => {
            lastAttempts.push(lastAttempt);
            if (!lastAttempt) throw new Error("Run run_1 has finished cells not folded yet");
          },
        },
      });
      const intent = {
        runId: "run_1",
        experimentId: "experiment_1",
        outcome: "finished" as const,
        finishedCells: 2,
      };

      await expect(complete(intent, intentContext)).rejects.toThrow("not folded yet");
      expect(completed).toEqual([]);
      await complete(intent, { ...intentContext, attempt: EXPERIMENT_RUN_INTENT_ATTEMPTS });

      expect(lastAttempts).toEqual([false, true]);
      expect(completed).toHaveLength(1);
    });
  });
});
