import type { IntentContext } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import type { ExperimentRunCommandDispatcherService } from "../../services/experiment-run-command-dispatcher.service.ts";
import { completeRun, failLostCell } from "../experiment-run-execution.intent.ts";

type Sent = Parameters<ExperimentRunCommandDispatcherService["failExperimentCell"]>[0];
type Completed = Parameters<ExperimentRunCommandDispatcherService["completeExperimentRun"]>[0];

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
  return {
    failed,
    completed,
    commands: {
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

      await completeRun(run)(
        { runId: "run_1", experimentId: "experiment_1", outcome: "stopped" },
        intentContext,
      );

      expect(completed[0]).toMatchObject({ runId: "run_1", outcome: "stopped" });
      expect(completed[0]).toHaveProperty("stoppedAt");
      expect(completed[0]).not.toHaveProperty("finishedAt");
    });
  });
});
