import { createTenantId } from "@langwatch/eventing";
import { ExperimentEvaluationInputError } from "@langwatch/experiment-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  EXPERIMENT_RUN_COMMAND_TYPES,
  EXPERIMENT_RUN_EVENT_TYPES,
} from "../../rules/experiment-run-event-types.rules.ts";
import type {
  ExperimentCellExecution,
  ExperimentCellRequest,
  ExperimentRunCellService,
} from "../../services/experiment-run-cell.service.ts";
import {
  type ExecuteExperimentCellCommandData,
  ExecuteExperimentCellCommand,
  executeExperimentCellJobId,
} from "../experiment-run-cell.commands.ts";

const payload: ExecuteExperimentCellCommandData = {
  tenantId: "project_alpha",
  occurredAt: 1_000,
  runId: "run_1",
  experimentId: "experiment_1",
  ordinal: 3,
  phase: 1,
};

function command() {
  return {
    tenantId: createTenantId("project_alpha"),
    aggregateId: ExecuteExperimentCellCommand.getAggregateId(payload),
    type: EXPERIMENT_RUN_COMMAND_TYPES.EXECUTE_CELL,
    data: payload,
  };
}

function handlerAnswering(execution: ExperimentCellExecution) {
  const requests: ExperimentCellRequest[] = [];
  const handler = ExecuteExperimentCellCommand.create({
    cells: createApiFixture<ExperimentRunCellService>({
      execute: (request) => {
        requests.push(request);
        return Promise.resolve(execution);
      },
    }),
  });
  return { handler, requests };
}

const envelope = { tenantId: "project_alpha", runId: "run_1", experimentId: "experiment_1" };

describe("ExecuteExperimentCellCommand", () => {
  describe("when the cell produced results", () => {
    /** @scenario "The worker runs an opened cell by its ordinal and phase" */
    it("appends them in order, then the cell's finish, in one batch", async () => {
      const { handler, requests } = handlerAnswering({
        outcome: "succeeded",
        results: [
          {
            kind: "target",
            data: { ...envelope, occurredAt: 1_500, index: 0, targetId: "target_a", entry: {} },
          },
          {
            kind: "evaluator",
            data: {
              ...envelope,
              occurredAt: 1_600,
              index: 0,
              targetId: "target_a",
              evaluatorId: "exact",
              status: "processed",
              score: 1,
            },
          },
        ],
      });

      const events = await handler.handle(command());

      expect(requests).toEqual([
        {
          projectId: "project_alpha",
          runId: "run_1",
          experimentId: "experiment_1",
          ordinal: 3,
          phase: 1,
        },
      ]);
      expect(events.map((event) => event.type)).toEqual([
        EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
        EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
        EXPERIMENT_RUN_EVENT_TYPES.CELL_FINISHED,
      ]);
      expect(events.every((event) => event.aggregateId === "experiment_1:run_1")).toBe(true);
      expect(events[2]?.data).toMatchObject({ ordinal: 3, phase: 1, outcome: "succeeded" });
    });

    /** @scenario "A cell run twice appends nothing twice" */
    it("keys each event as its own record command would, so a rerun collapses onto it", async () => {
      const { handler } = handlerAnswering({
        outcome: "succeeded",
        results: [
          {
            kind: "target",
            data: { ...envelope, occurredAt: 1_500, index: 0, targetId: "target_a", entry: {} },
          },
          {
            kind: "evaluator",
            data: {
              ...envelope,
              occurredAt: 1_600,
              index: 0,
              targetId: "target_a",
              evaluatorId: "exact",
              status: "processed",
            },
          },
        ],
      });

      const events = await handler.handle(command());

      expect(events.map((event) => event.idempotencyKey)).toEqual([
        "project_alpha:run_1:target:target_a:0",
        "project_alpha:run_1:evaluator:target_a:exact:0",
        "project_alpha:run_1:cell:3:1:finished",
      ]);
      expect(events[0]?.data).not.toHaveProperty("tenantId");
      expect(events[0]?.data).not.toHaveProperty("occurredAt");
    });
  });

  describe("when the cell failed", () => {
    it("finishes it failed with the error it carried", async () => {
      const error = new ExperimentEvaluationInputError({
        status: 404,
        reason: "Prompt not found",
      }).serialize();
      const { handler } = handlerAnswering({ outcome: "failed", error, results: [] });

      const [finished] = await handler.handle(command());

      expect(finished?.data).toMatchObject({ outcome: "failed", error: { code: error.code } });
    });
  });

  describe("when the cell service throws", () => {
    it("appends nothing and lets the queue retry the command", async () => {
      const handler = ExecuteExperimentCellCommand.create({
        cells: createApiFixture<ExperimentRunCellService>({
          execute: () => Promise.reject(new Error("plan not folded yet")),
        }),
      });

      await expect(handler.handle(command())).rejects.toThrow("plan not folded yet");
    });
  });

  describe("when the queue groups and deduplicates cells", () => {
    /** @scenario "A run's cells run side by side" */
    it("gives each cell of a run its own group, and each cell one job id", () => {
      const other = { ...payload, ordinal: 4 };

      expect(ExecuteExperimentCellCommand.getGroupKey(payload)).not.toBe(
        ExecuteExperimentCellCommand.getGroupKey(other),
      );
      expect(executeExperimentCellJobId(payload)).toBe("project_alpha:run_1:3:1");
      expect(executeExperimentCellJobId({ ...payload, phase: 2 })).toBe("project_alpha:run_1:3:2");
    });
  });
});
